import test from "node:test";
import assert from "node:assert/strict";
import {
  parseFundSnapshots,
  parseNavHistory,
  parseCapitalPortfolio,
  fundNav,
  fundPeers,
  fundHolders,
  fundPortfolio,
  FUND_URLS,
} from "../../api/fund-data.js";
import {
  parseBookValue,
  officialBookValue,
} from "../../api/official-financial.js";
import { valuationBands } from "../../api/valuation-bands.js";
import { summarize } from "../../api/fundamentals.js";
import { clearSourceCache } from "../../api/source-cache.js";
import { taipeiDay, addDays } from "../../api/lib.js";
const quote = (a = "00927", i = "20261120") => ({
  a,
  b: "測試ETF",
  c: "1000",
  d: "0",
  e: "25.61",
  f: "25.71",
  g: "0",
  h: "未結出",
  i,
  j: "15:00:00",
  k: "1",
});
const feed = (rows) => ({ a1: [{ rtCode: "0000", msgArray: rows }] });
const profile = (code = "00927", index = "半導體指數") => ({
  基金代號: code,
  基金簡稱: "測試ETF",
  基金類型: "國內成分證券指數股票型基金",
  "標的指數/追蹤指數名稱": index,
});
const pcf = () => ({
  code: 200,
  data: {
    pcf: { date1: addDays(taipeiDay(), 3), date2: taipeiDay() },
    stocks: [{ stocNo: "2330", stocName: "台積電", share: 1000, weight: 20 }],
    futures: [{}],
  },
});
test("ETF 快照保留來源零折溢價；預估、前日淨值分離，拒絕重複代號和錯誤時間", () => {
  const rows = parseFundSnapshots(feed([quote()]));
  assert.equal(rows[0].premium_percent, 0);
  assert.equal(rows[0].indicative_nav, 25.71);
  assert.equal(rows[0].previous_nav, null);
  assert.equal(
    parseFundSnapshots({ a1: [{ msgArray: [quote()] }] }).length,
    1,
    "投信聚合快照可能省略 rtCode，但有效欄位仍可核對",
  );
  assert.ok(rows[0].calculated_premium_percent < 0);
  assert.match(rows[0].source_time, /\+08:00$/);
  assert.equal(parseFundSnapshots(feed([quote(), quote()])).length, 0);
  assert.throws(() =>
    parseFundSnapshots(feed([{ ...quote(), j: "99:99:99" }])),
  );
});
test("ETF 歷史淨值必須有完整年月日，只切所選區間，折溢價空值不補零", () => {
  const data = parseNavHistory(
    {
      netPrice: [
        { date: "2026/11/19", count: 28 },
        { date: "11/20", count: 999 },
        { date: "2026/11/20", count: 25.71 },
        { date: "2026/11/21", count: 99 },
      ],
      atmps: [{ date: "2026/11/19", count: 0 }],
    },
    "2026-11-19",
    "2026-11-20",
  );
  assert.equal(data.length, 2);
  assert.equal(data[0].premium_percent, 0);
  assert.equal(data[1].premium_percent, null);
});
test("PCF 估值日與下個適用日分離；股數不當成張，不把未核對明細當完整清單", () => {
  const data = parseCapitalPortfolio(pcf(), {
    stockNo: "00927",
    shortName: "ETF",
    fundNo: "366",
  });
  assert.equal(data.rows[0].holding_shares, 1000);
  assert.equal(data.rows[0].date, taipeiDay());
  assert.equal(data.rows[0].effective_date, addDays(taipeiDay(), 3));
  assert.equal(data.other_assets_present, true);
  const invalid = pcf();
  invalid.data.stocks[0].share = -1;
  assert.throws(() => parseCapitalPortfolio(invalid, {}));
});
test("歷史查詢不偷帶今日預估淨值；來源失敗與歷史成功分開", async (t) => {
  clearSourceCache();
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url) === FUND_URLS.snapshot)
      return Response.json(feed([quote()]));
    return Response.json({
      netPrice: [{ date: "2026/10/01", count: 40 }],
      atmps: [],
    });
  });
  const data = await fundNav("TWSE", "00927", "2026-10-01", "2026-10-08");
  assert.equal(data.snapshot, null);
  assert.equal(data.history.length, 1);
  assert.equal(data.coverage[0].status, "outside_range");
  assert.equal(data.database_used, false);
});
test("同類基金以官方分類選候選、同指數優先，不以最新快照冒充舊日；無行情不標可用", async (t) => {
  clearSourceCache();
  t.mock.method(globalThis, "fetch", async (url) =>
    Response.json(
      String(url) === FUND_URLS.profiles
        ? [profile(), profile("00999"), profile("00998", "不同指數")]
        : feed([quote(), quote("00999")]),
    ),
  );
  const current = await fundPeers("TWSE", "00927", "2026-11-20");
  assert.equal(current.rows.length, 3);
  assert.ok(current.rows[0].selected);
  assert.equal(current.rows[1].business_peer, true);
  assert.equal(
    current.rows.find((r) => r.symbol === "00998").status,
    "outside_range",
  );
  const old = await fundPeers("TWSE", "00927", "2026-10-01");
  assert.ok(
    old.rows.every((r) => r.snapshot === null && r.status !== "available"),
  );
});
test("反查持股只涵蓋實際查過的國內基金，部分失敗不宣稱全市場完整", async (t) => {
  clearSourceCache();
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    if (String(url) === FUND_URLS.profiles)
      return Response.json([profile(), profile("00999")]);
    if (String(url) === FUND_URLS.capitalList)
      return Response.json({
        code: 200,
        data: {
          funds: [
            { fundNo: "366", stockNo: "00927", shortName: "ETF" },
            { fundNo: "2", stockNo: "00999", shortName: "失敗基金" },
            { fundNo: "3", stockNo: "00988", shortName: "未列國內基金" },
          ],
        },
      });
    if (JSON.parse(opts.body).fundId === "2")
      return new Response("failed", { status: 503 });
    return Response.json(pcf());
  });
  const data = await fundHolders("TWSE", "2330", taipeiDay());
  assert.equal(data.rows.length, 1);
  assert.equal(data.status, "partial");
  assert.equal(data.coverage.all_market, false);
  assert.equal(data.coverage.funds_requested, 2);
  assert.equal(data.coverage.funds_loaded, 1);
  assert.deepEqual(data.coverage.failed_funds, ["00999"]);
});
test("官方每股參考淨值直接取來源，接受零值、不以股本自行換算或回填舊季", () => {
  const rows = parseBookValue(
    [
      {
        公司代號: "2409",
        年度: "115",
        季別: "3",
        股本: "999999",
        每股參考淨值: "20.11",
      },
    ],
    "2409",
    "TWSE",
  );
  assert.equal(rows[0].value, 20.11);
  assert.equal(rows[0].date, "2026-09-30");
  assert.equal(
    summarize({ OfficialBookValue: rows }, "2026-11-20", false).metrics.find(
      (m) => m.key === "book_value_per_share",
    ).value,
    20.11,
  );
  assert.equal(
    summarize({ OfficialBookValue: rows }, "2026-06-30", false).metrics.some(
      (m) => m.key === "book_value_per_share",
    ),
    false,
  );
  assert.deepEqual(
    parseBookValue(
      [{ 公司代號: "2409", 年度: "115", 季別: "3", 股本: "1000" }],
      "2409",
      "TWSE",
    ),
    [],
  );
});
test("跨日查最新PCF依估值日判斷，不要求截止等於今天；較早截止不洩漏未來組合", async (t) => {
  clearSourceCache();
  const data = pcf();
  const yesterday = addDays(taipeiDay(), -1);
  data.data.pcf.date2 = yesterday;
  t.mock.method(globalThis, "fetch", async (url) =>
    Response.json(
      String(url) === FUND_URLS.capitalList
        ? {
            code: 200,
            data: {
              funds: [{ fundNo: "366", stockNo: "00927", shortName: "ETF" }],
            },
          }
        : data,
    ),
  );
  const latest = await fundPortfolio("TWSE", "00927", yesterday);
  assert.equal(latest.status, "available");
  assert.equal(latest.date, yesterday);
  assert.equal(latest.rows.length, 1);
  const old = await fundPortfolio("TWSE", "00927", addDays(yesterday, -1));
  assert.equal(old.status, "outside_range");
  assert.equal(old.rows.length, 0);
  assert.equal(old.latest_source_date, yesterday);
});
test("所有PCF來源失敗不能標成部分可用；截止前無可用組合與真實零筆分開", async (t) => {
  clearSourceCache();
  let failed = true;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("cwapi.cathaysite.com.tw"))
      return Response.json({
        returnCode: "2000",
        success: true,
        result: [],
        totalCount: 0,
      });
    if (String(url) === FUND_URLS.profiles) return Response.json([profile()]);
    if (String(url) === FUND_URLS.capitalList)
      return Response.json({
        code: 200,
        data: {
          funds: [{ fundNo: "366", stockNo: "00927", shortName: "ETF" }],
        },
      });
    return failed
      ? new Response("failed", { status: 503 })
      : Response.json(pcf());
  });
  const error = await fundHolders("TWSE", "2330", taipeiDay());
  assert.equal(error.status, "source_error");
  assert.equal(error.coverage.funds_eligible, 0);
  clearSourceCache();
  failed = false;
  const outside = await fundHolders("TWSE", "2330", addDays(taipeiDay(), -1));
  assert.equal(outside.status, "outside_range");
  assert.equal(outside.rows.length, 0);
  assert.equal(outside.coverage.outside_range_funds.length, 1);
  const empty = await fundHolders("TWSE", "9999", taipeiDay());
  assert.equal(empty.status, "available");
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.coverage.funds_eligible, 1);
});
test("淨值兩個來源皆故障標記來源失敗，不冒充無紀錄", async (t) => {
  clearSourceCache();
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("failure", { status: 503 }),
  );
  const data = await fundNav(
    "TWSE",
    "00927",
    addDays(taipeiDay(), -30),
    taipeiDay(),
  );
  assert.equal(data.status, "source_error");
  assert.ok(data.coverage.every((r) => r.status === "source_error"));
});
test("官方一般業財報失敗仍可取得金融業；未查完不能宣稱沒有淨值", async (t) => {
  clearSourceCache();
  let financial = true;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).endsWith("_ci"))
      return new Response("failure", { status: 503 });
    if (financial && String(url).endsWith("_basi"))
      return Response.json([
        { 公司代號: "2883", 年度: "115", 季別: "3", 每股參考淨值: "12" },
      ]);
    return Response.json([]);
  });
  const rows = await officialBookValue("TWSE", "2883");
  assert.equal(rows[0].value, 12);
  assert.match(rows[0].source_url, /_basi$/);
  clearSourceCache();
  financial = false;
  await assert.rejects(officialBookValue("TWSE", "2883"), /尚不能判定/);
});
test("來源倍數參考帶不讀未來資料、不使用零／負本益比，暖機不足不生價位", () => {
  const bars = Array.from({ length: 80 }, (_, i) => ({
    trade_date: addDays("2026-01-01", i),
    close: 100 + i,
    is_final: true,
  }));
  const ratios = bars.map((b, i) => ({ date: b.trade_date, PER: 10 + i / 10 }));
  const first = valuationBands(bars.slice(0, 70), ratios.slice(0, 70), "PER");
  const all = valuationBands(bars, ratios, "PER");
  assert.deepEqual(first.rows, all.rows.slice(0, first.rows.length));
  assert.equal(valuationBands(bars.slice(0, 59), ratios, "PER").rows.length, 0);
  assert.equal(
    valuationBands(
      bars,
      ratios.map((r) => ({ ...r, PER: 0 })),
      "PER",
    ).rows.length,
    0,
  );
  assert.ok(
    all.rows.every((r) => r.q20 <= r.q40 && r.q40 <= r.q60 && r.q60 <= r.q80),
  );
});
