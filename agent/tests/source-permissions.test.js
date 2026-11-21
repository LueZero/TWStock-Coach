import test from "node:test";
import assert from "node:assert/strict";
import { FinMind } from "../../api/providers.js";
import { DailyProvider } from "../../api/daily-provider.js";
import { finMindError } from "../../api/source-errors.js";
import { directEquity } from "../../api/direct-data.js";
import { clearSourceCache, cachedResources } from "../../api/source-cache.js";
import { buildChipWorkspace } from "../../api/chip-workspace.js";

test("只有股價不算主力觀測，有來源的零淨買賣超仍保留", () => {
  const prices = [{ trade_date: "2026-11-13", close: 20, volume: 1000 }];
  assert.equal(
    buildChipWorkspace({}, "2026-11-01", "2026-11-20", [], prices).main.length,
    0,
  );
  const data = {
    TaiwanStockBrokerDailyConcentration: [
      { date: "2026-11-13", top_buy_volume: 0, top_sell_volume: 0 },
    ],
  };
  const rows = buildChipWorkspace(
    data,
    "2026-11-01",
    "2026-11-20",
    [],
    prices,
  ).main;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].net, 0);
});

test("來源權限、Token與配額錯誤分開，拒絕回傳原始錯誤文字", () => {
  assert.equal(
    finMindError(400, { msg: "TokenLevelTooLow secret-value" }).code,
    "SOURCE_PERMISSION",
  );
  assert.equal(
    finMindError(400, { msg: "Please sponsor" }).code,
    "SOURCE_PERMISSION",
  );
  assert.equal(finMindError(400, { msg: "TokenIllegal" }).code, "SOURCE_AUTH");
  assert.equal(finMindError(402).code, "SOURCE_QUOTA");
  assert.equal(finMindError(403, { msg: "ip banned" }).code, "SOURCE_BLOCKED");
  assert.doesNotMatch(
    finMindError(400, { msg: "secret-value" }).message,
    /secret-value/,
  );
});

test("權限拒絕不重試，同帳戶不同股票不重複打受限資料集，換Token可重新核對", async () => {
  const original = process.env.FINMIND_TOKEN;
  let calls = 0;
  const provider = new FinMind(async () => {
    calls++;
    return Response.json(
      { status: 400, msg: "TokenLevelTooLow" },
      { status: 400 },
    );
  });
  provider.interval = 0;
  try {
    process.env.FINMIND_TOKEN = "permission-test-a";
    await assert.rejects(
      provider.get("RestrictedTest", { data_id: "2409" }),
      (e) => e.code === "SOURCE_PERMISSION",
    );
    await assert.rejects(
      provider.get("RestrictedTest", { data_id: "2330" }),
      (e) => e.code === "SOURCE_PERMISSION",
    );
    assert.equal(calls, 1);
    process.env.FINMIND_TOKEN = "permission-test-b";
    await assert.rejects(
      provider.get("RestrictedTest"),
      (e) => e.code === "SOURCE_PERMISSION",
    );
    assert.equal(calls, 2);
  } finally {
    if (original === undefined) delete process.env.FINMIND_TOKEN;
    else process.env.FINMIND_TOKEN = original;
  }
});

test("免費Token歷史分布被拒絕時使用TDCC最新週，申報無紀錄不標成權限不足", async (t) => {
  const original = process.env.FINMIND_TOKEN;
  process.env.FINMIND_TOKEN = "free-test";
  clearSourceCache();
  let releaseCatalog;
  const catalogGate = new Promise((resolve) => {
    releaseCatalog = resolve;
  });
  const levels = Array.from({ length: 17 }, (_, i) => ({
    證券代號: "2409",
    資料日期: "20261113",
    持股分級: String(i + 1),
    股數: "1000",
    人數: "10",
    "占集保庫存數比例%": i === 16 ? "100" : "1",
  }));
  t.mock.method(globalThis, "fetch", async (url) =>
    Response.json(
      String(url).includes("tdcc.com.tw")
        ? levels
        : String(url).includes("t187ap11_L")
          ? [
              {
                公司代號: "2409",
                資料年月: "11510",
                出表日期: "1151119",
                職稱: "董事",
                姓名: "測試",
                目前持股: "1000",
                設質股數: "0",
              },
            ]
          : [],
    ),
  );
  t.mock.method(DailyProvider.prototype, "daily", async () => ({ bars: [] }));
  t.mock.method(FinMind.prototype, "get", async (dataset) => {
    if (dataset === "TaiwanStockInfo") {
      await catalogGate;
      return [{ stock_id: "2409", stock_name: "友達", type: "twse" }];
    }
    if (dataset === "TaiwanStockHoldingSharesPer")
      throw finMindError(400, { msg: "TokenLevelTooLow" });
    return [];
  });
  t.mock.method(FinMind.prototype, "branches", async () => {
    throw finMindError(400, { msg: "TokenLevelTooLow" });
  });
  try {
    const pending = directEquity("TWSE", "2409", "2026-11-01", "2026-11-20");
    await new Promise((resolve) => setImmediate(resolve));
    await Promise.all(cachedResources().map((e) => e.promise));
    releaseCatalog();
    const result = await pending;
    const distribution = result.data.coverage.find(
      (r) => r.dataset === "TaiwanStockHoldingSharesPer",
    );
    assert.equal(distribution.status, "available");
    assert.equal(distribution.source, "tdcc");
    assert.match(distribution.message, /最新免費週資料/);
    assert.equal(result.data.details.distribution.length, 17);
    const directors = result.data.coverage.find(
      (r) => r.dataset === "DirectorHoldingsReport",
    );
    assert.equal(directors.status, "available");
    assert.equal(directors.scope, "latest_position");
    assert.equal(directors.data_end, "2026-10-01");
    const transfers = result.data.coverage.find(
      (r) => r.dataset === "InsiderTransfersReport",
    );
    assert.equal(transfers.status, "no_data");
    assert.match(transfers.message, /不代表歷史從未申報/);
    assert.equal(
      result.data.coverage.find(
        (r) => r.dataset === "TaiwanStockTradingDailyReport",
      ).status,
      "permission_denied",
    );
  } finally {
    if (original === undefined) delete process.env.FINMIND_TOKEN;
    else process.env.FINMIND_TOKEN = original;
  }
});
