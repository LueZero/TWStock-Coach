import test from "node:test";
import assert from "node:assert/strict";
import {
  createMarketScreen,
  normalizeMarketRows,
  screenOptions,
} from "../../api/market-screen.js";
import { createAssistantTools } from "../assistant-tools.js";
import { stockPriceValues } from "../price-evidence.js";
const twse = [
  {
    Date: "1151016",
    Code: "2330",
    Name: "台積電",
    ClosingPrice: "100",
    Change: "5",
    TradeVolume: "20,000",
    TradeValue: "2,000,000",
  },
  {
    Date: "1151016",
    Code: "2409",
    Name: "友達",
    ClosingPrice: "15",
    Change: "-1",
    TradeVolume: "30,000",
    TradeValue: "450000",
  },
  {
    Date: "1151016",
    Code: "00927",
    Name: "群益半導體收益",
    ClosingPrice: "40",
    Change: "0",
    TradeVolume: "90000",
    TradeValue: "3600000",
  },
  {
    Date: "1151016",
    Code: "030001",
    Name: "權證",
    ClosingPrice: "1",
    Change: "0",
    TradeVolume: "999999999",
  },
  {
    Date: "1151016",
    Code: "2883",
    Name: "凱基金",
    ClosingPrice: "--",
    Change: "--",
    TradeVolume: "0",
    TradeValue: "0",
  },
];
const tpex = [
  {
    Date: "1151016",
    SecuritiesCompanyCode: "6488",
    CompanyName: "環球晶",
    Close: "200",
    Change: "-5",
    TradingShares: "40000",
    TransactionAmount: "8000000",
  },
];
test("全市場價量正規化保留前導零、股數與空值，排除權證並按條件排序分頁", async () => {
  const rows = normalizeMarketRows("TWSE", twse);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].volume_shares, 20000);
  assert.equal(rows[0].trade_date, "2026-10-16");
  assert.ok(Math.abs(rows[0].change_percent - (5 / 95) * 100) < 1e-10);
  assert.equal(rows.find((r) => r.symbol === "00927").asset, "etf");
  assert.equal(rows.at(-1).close, null);
  const screen = createMarketScreen({
    load: async (url) => (url.includes("twse") ? twse : tpex),
  });
  const result = await screen({
    max_price: 200,
    min_volume_shares: 20000,
    sort_by: "volume_shares",
    limit: 2,
  });
  assert.equal(result.complete, true);
  assert.equal(result.realtime, false);
  assert.equal(result.groups[0].matched_count, 3);
  assert.deepEqual(
    result.groups[0].rows.map((r) => r.symbol),
    ["6488", "2409"],
  );
  assert.equal(result.groups[0].has_more, true);
  const prices = stockPriceValues({ evidence: [{ data: result }] });
  assert.ok(prices.has("200"));
  assert.ok(!prices.has("40000"));
  assert.deepEqual(
    (await screen({ offset: 2 })).groups[0].rows.map((r) => r.symbol),
    ["2330"],
  );
  assert.equal(
    (await screen({ asset: "etf" })).groups[0].rows[0].symbol,
    "00927",
  );
  assert.equal((await screen({ min_price: 9999 })).groups[0].matched_count, 0);
});
test("市場日期不一致分組，來源失敗明示不完整，過期快取不冒充最新", async () => {
  let clock = 0,
    down = false;
  const screen = createMarketScreen({
    clock: () => clock,
    load: async (url) => {
      if (down) throw Error("offline");
      return url.includes("twse")
        ? twse
        : tpex.map((r) => ({ ...r, Date: "1151019" }));
    },
  });
  const result = await screen();
  assert.equal(result.complete, false);
  assert.deepEqual(
    result.groups.map((g) => g.trade_date),
    ["2026-10-16", "2026-10-19"],
  );
  clock = 300001;
  down = true;
  await assert.rejects(screen(), /暫時無法取得/);
  const partial = await createMarketScreen({
    load: async (url) => {
      if (url.includes("tpex")) throw Error("offline");
      return twse;
    },
  })();
  assert.equal(partial.complete, false);
  assert.equal(partial.sources[1].available, false);
});
test("選股拒絕無效數值、不支援條件及反向範圍", () => {
  for (const options of [
    { min_price: "NaN" },
    { limit: 51 },
    { limit: 1.2 },
    { max_price: -1 },
    { min_price: 20, max_price: 10 },
    { min_change_percent: 5, max_change_percent: -5 },
    { pe: 10 },
    { offset: Infinity },
    { min_volume_shares: true },
  ])
    assert.throws(() => screenOptions(options));
});
test("Codex全市場工具實際呼叫平台篩選API、留下證據且拒絕歷史穿越", async () => {
  const requests = [],
    calls = [];
  const context = {
    api_url: "http://localhost:8000",
    scope: { mode: "latest", end: "2026-10-19" },
  };
  const tools = createAssistantTools(context, {
    onCall: (c) => calls.push(c),
    fetcher: async (url) => {
      requests.push(String(url));
      return Response.json({
        kind: "official_daily_screen",
        groups: [],
        complete: true,
      });
    },
  });
  await assert.rejects(
    tools.call("screen_market_stocks", {}),
    /twstock-evidence/,
  );
  await tools.call("read_research_skill", { name: "twstock-evidence" });
  const result = await tools.call("screen_market_stocks", {
    max_price: 100,
    min_volume_shares: 1000000,
    sort_by: "volume_shares",
    limit: 10,
  });
  assert.match(requests[0], /\/api\/market\/screen\?/);
  assert.match(requests[0], /min_volume_shares=1000000/);
  assert.ok(result.evidence_id);
  assert.equal(calls.at(-1).category, "screen");
  await assert.rejects(
    tools.call("screen_market_stocks", { rsi: 30 }),
    /參數不符/,
  );
  context.scope.mode = "historical";
  await assert.rejects(tools.call("screen_market_stocks", {}), /歷史截止/);
  assert.equal(requests.length, 1);
});
