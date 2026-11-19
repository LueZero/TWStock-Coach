import test from "node:test";
import assert from "node:assert/strict";
import { DailyProvider, parseTwseDaily } from "../../api/daily-provider.js";

import { saved } from "../../api/market-board.js";
import { getQuote } from "../../api/market.js";
import { FinMind } from "../../api/providers.js";
const fixture = {
  stat: "OK",
  date: "20261001",
  title: "115年10月 2330 台積電 各日成交資訊",
  fields: [
    "日期",
    "成交股數",
    "成交金額",
    "開盤價",
    "最高價",
    "最低價",
    "收盤價",
  ],
  data: [
    ["115/10/01", "12,345", "123456", "100", "105", "99", "103"],
    ["115/10/02", "0", "0", "--", "--", "--", "--"],
  ],
};

test("來源重試等待不獨占共用佇列，其他資料可先取得", async () => {
  const calls = [];
  let failed = false;
  const p = new FinMind(async (url) => {
    const symbol = new URL(url).searchParams.get("data_id");
    calls.push(symbol);
    if (symbol === "2409" && !failed) {
      failed = true;
      throw Error("temporary transport error");
    }
    return Response.json({ status: 200, data: [{ stock_id: symbol }] });
  });
  p.interval = 0;
  const [a, b] = await Promise.all([
    p.get("TaiwanStockPER", { data_id: "2409" }),
    p.get("TaiwanStockPER", { data_id: "2330" }),
  ]);
  assert.deepEqual(calls, ["2409", "2330", "2409"]);
  assert.equal(a[0].stock_id, "2409");
  assert.equal(b[0].stock_id, "2330");
});
test("官方日線核對標的、月份與欄位，精確保留成交股數，不以停牌空值補零", () => {
  const parsed = parseTwseDaily(fixture, "2330", "2026-10-01");
  assert.equal(parsed.bars.length, 1);
  assert.equal(parsed.rejected.length, 1);
  assert.equal(parsed.bars[0].volume, 12345);
  assert.equal(parsed.bars[0].source, "twse");
  assert.equal(parsed.bars[0].price_basis, "raw");
  assert.throws(() => parseTwseDaily(fixture, "2409", "2026-10-01"));
  assert.throws(() => parseTwseDaily(fixture, "2330", "2026-09-01"));
  assert.throws(() =>
    parseTwseDaily({ ...fixture, fields: ["日期"] }, "2330", "2026-10-01"),
  );
  assert.throws(() =>
    parseTwseDaily(
      { ...fixture, data: [fixture.data[0], fixture.data[0]] },
      "2330",
      "2026-10-01",
    ),
  );
});
test("日線官方優先並切出查詢區間，來源故障時實際降級且留下警告", async () => {
  let calls = 0,
    fallbacks = 0;
  const fallback = {
    daily: async () => {
      fallbacks++;
      return { bars: [], rejected: [] };
    },
  };
  const p = new DailyProvider(
    async (url) => {
      calls++;
      assert.equal(new URL(url).searchParams.get("stockNo"), "2330");
      return Response.json(fixture);
    },
    { fallback, interval: 0 },
  );
  const result = await p.daily("TWSE", "2330", "2026-10-01", "2026-10-01");
  assert.equal(result.bars.length, 1);
  assert.equal(result.rejected.length, 0);
  assert.equal(fallbacks, 0);
  await p.daily("TPEX", "6488", "2026-10-01", "2026-10-02");
  await p.daily("TWSE", "2330", "2026-10-01", "2026-10-02", true);
  assert.equal(calls, 1);
  assert.equal(fallbacks, 2);
  const broken = new DailyProvider(
    async () => Response.json({ stat: "error" }),
    { fallback, interval: 0 },
  );
  assert.match(
    (await broken.daily("TWSE", "2330", "2026-10-01", "2026-10-02"))
      .source_warning,
    /FinMind/,
  );
});
test("取消官方日線查詢不再呼叫備援來源", async () => {
  const controller = new AbortController();
  controller.abort();
  let fallback = false;
  const p = new DailyProvider(
    async () => {
      throw Error("must not fetch");
    },
    {
      signal: controller.signal,
      interval: 0,
      fallback: {
        daily: async () => {
          fallback = true;
        },
      },
    },
  );
  await assert.rejects(p.daily("TWSE", "2330", "2026-10-01", "2026-10-02"));
  assert.equal(fallback, false);
});

test("長期均線日線使用單次區間查詢，失敗後走官方且不重複請求同一失敗來源", async () => {
  let bulk = 0,
    monthly = 0;
  const p = new DailyProvider(
    async () => {
      throw Error("不應下載月報");
    },
    {
      interval: 0,
      fallback: {
        daily: async () => {
          bulk++;
          return {
            bars: [{ trade_date: "2026-10-01", source: "finmind" }],
            rejected: [],
          };
        },
      },
    },
  );
  assert.equal(
    (await p.daily("TWSE", "2330", "2026-06-01", "2026-10-01")).bars[0].source,
    "finmind",
  );
  assert.equal(bulk, 1);
  p.fallback.daily = async () => {
    bulk++;
    throw Error("區間來源故障");
  };
  p.month = async (symbol, month) => {
    monthly++;
    return { bars: [{ trade_date: month, source: "twse" }], rejected: [] };
  };
  const official = await p.daily("TWSE", "2330", "2026-06-01", "2026-10-01");
  assert.equal(bulk, 2);
  assert.equal(monthly, 5);
  assert.equal(official.bars.length, 5);
  assert.match(official.source_warning, /官方月報/);
});

test("重疊日線查詢排隊期間重用已取得月份，不重複請求官方API", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({
      ...fixture,
      date: "20260901",
      title: "115年09月 2330 台積電 各日成交資訊",
      data: [["115/09/01", "12,345", "123456", "100", "105", "99", "103"]],
    });
  });
  const provider = new DailyProvider(fetch, { interval: 0 });
  const [a, b] = await Promise.all([
    provider.month("2330", "2026-09-01"),
    provider.month("2330", "2026-09-01"),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
});
test("大盤即時行情與分時僅使用記憶體快取，失敗可標示舊快取但不讀寫DB", async () => {
  const key = "quotes:unit-test:" + Date.now();
  const result = await saved(key, 0, async () => ({
    products: [],
    received_at: "2026-10-01T00:00:00Z",
  }));
  assert.deepEqual(result.products, []);
  const stale = await saved(key, 0, async () => {
    throw Error("offline");
  });
  assert.equal(stale.stale, true);
  await assert.rejects(
    saved("intraday:unit-test:" + Date.now(), 0, async () => {
      throw Error("offline");
    }),
    /offline/,
  );
});
test("一般個股行情請求不需DB即可回傳價格及五檔", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      rtcode: "0000",
      msgArray: [
        {
          c: "9999",
          ex: "tse",
          n: "測試",
          d: "20261008",
          tlong: String(Date.parse("2026-10-08T13:30:00+08:00")),
          t: "13:30:00",
          z: "100",
          y: "99",
          v: "10",
          b: "99_98_97_96_95",
          g: "1_2_3_4_5",
          a: "100_101_102_103_104",
          f: "1_2_3_4_5",
        },
      ],
    });
  try {
    const result = await getQuote("TWSE", "9999");
    assert.equal(result.last_price, 100);
    assert.equal(result.bids.length, 5);
    assert.equal(result.volume_shares, 10000);
  } finally {
    globalThis.fetch = original;
  }
});
