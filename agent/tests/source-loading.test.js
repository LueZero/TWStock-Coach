import test from "node:test";
import assert from "node:assert/strict";
import { FinMind } from "../../api/providers.js";
import { DailyProvider } from "../../api/daily-provider.js";
import { directEquity, directFinancial } from "../../api/direct-data.js";
import { createApp } from "../../api/api.js";
import { cachedResources, clearSourceCache } from "../../api/source-cache.js";

test("基本資料不觸發籌碼或歷史K線；籌碼依區間查詢且不把載入中當成空資料", async (t) => {
  clearSourceCache();
  const calls = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let finishPrices;
  const priceGate = new Promise((resolve) => {
    finishPrices = resolve;
  });
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => [],
  }));
  t.mock.method(DailyProvider.prototype, "daily", async () => {
    await priceGate;
    return { bars: [] };
  });
  t.mock.method(FinMind.prototype, "get", async (dataset, params) => {
    calls.push({ dataset, params });
    if (dataset === "TaiwanStockInfo")
      return [
        {
          stock_id: "2409",
          stock_name: "友達",
          type: "twse",
          industry_category: "光電業",
        },
      ];
    await gate;
    if (dataset === "TaiwanStockShareholding")
      return [{ stock_id: "2409", date: "2026-11-01" }];
    return [];
  });
  const basic = await directEquity(
    "TWSE",
    "2409",
    "2026-10-01",
    "2026-10-08",
    null,
    "basic",
  );
  await Promise.all(cachedResources().map((e) => e.promise));
  assert.equal(basic.database_used, false);
  assert.deepEqual(
    calls.map((c) => c.dataset),
    ["TaiwanStockInfo"],
  );
  assert.equal(cachedResources().length, 1);
  const app = await createApp();
  try {
    const response = await app.inject(
      "/api/stock-data/TWSE/2409?section=basic&start=2026-10-01&end=2026-10-08",
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().database_used, false);
  } finally {
    await app.close();
  }
  const pending = await directEquity(
    "TWSE",
    "2409",
    "2026-10-01",
    "2026-10-08",
  );
  assert.equal(pending.state, "updating");
  const institution = pending.data.coverage.find(
    (r) => r.dataset === "TaiwanStockInstitutionalInvestorsBuySell",
  );
  assert.equal(institution.status, "loading");
  assert.equal(
    pending.data.coverage.find((r) => r.dataset === "CompanyProfile").status,
    "no_data",
  );
  assert.ok(calls.filter((c) => c.dataset !== "TaiwanStockInfo").length >= 3);
  for (const call of calls.filter((c) => c.dataset !== "TaiwanStockInfo")) {
    assert.equal(call.params.start_date, "2026-10-01");
    assert.equal(call.params.end_date, "2026-10-08");
  }
  release();
  await Promise.all(
    cachedResources()
      .filter((e) => e.value?.snapshots)
      .map((e) => e.promise),
  );
  const waitingPrices = await directEquity(
    "TWSE",
    "2409",
    "2026-10-01",
    "2026-10-08",
  );
  assert.equal(waitingPrices.state, "updating");
  assert.equal(waitingPrices.data.price_context.state, "updating");
  finishPrices();
  await Promise.all(cachedResources().map((e) => e.promise));
  const complete = await directEquity(
    "TWSE",
    "2409",
    "2026-10-01",
    "2026-10-08",
  );
  assert.equal(
    complete.data.coverage.find((r) => r.dataset === institution.dataset)
      .status,
    "no_data",
  );
  assert.equal(
    complete.data.coverage.find((r) => r.dataset === "TaiwanStockShareholding")
      .status,
    "outside_range",
  );
  const count = calls.length;
  await directEquity("TWSE", "2409", "2026-10-01", "2026-10-08");
  assert.equal(calls.length, count);
});

test("財務部分失敗一分鐘後只重試失敗來源；載入中與空資料區分", async (t) => {
  clearSourceCache();
  const calls = [];
  let broken = true;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  t.mock.method(FinMind.prototype, "get", async (dataset) => {
    calls.push(dataset);
    await gate;
    if (dataset === "TaiwanStockBalanceSheet" && broken)
      throw Error("FinMind HTTP 503; check entitlement/quota");
    return [];
  });
  const pending = await directFinancial("TWSE", "2409");
  assert.ok(
    pending.data.coverage.some(
      (c) => c.status === "loading" || c.status === "queued",
    ),
  );
  release();
  await Promise.all(cachedResources().map((e) => e.promise));
  const failed = await directFinancial("TWSE", "2409");
  assert.equal(failed.state, "partial");
  assert.equal(failed.update.status, "partial");
  assert.equal(
    failed.update.details.datasets.TaiwanStockBalanceSheet.status,
    "source_error",
  );
  assert.equal(
    failed.data.coverage.find((c) => c.dataset === "TaiwanStockBalanceSheet")
      .status,
    "source_error",
  );
  const n = calls.length;
  await directFinancial("TWSE", "2409");
  assert.equal(calls.length, n);
  cachedResources().forEach((e) => {
    e.at -= 61000;
  });
  broken = false;
  await directFinancial("TWSE", "2409");
  await Promise.all(cachedResources().map((e) => e.promise));
  assert.deepEqual(calls.slice(n), ["TaiwanStockBalanceSheet"]);
  const restored = await directFinancial("TWSE", "2409");
  assert.equal(restored.state, "ready");
  assert.equal(
    restored.data.coverage.find((c) => c.dataset === "TaiwanStockBalanceSheet")
      .status,
    "no_data",
  );
  const reused = await directFinancial("TWSE", "2409");
  assert.equal(
    reused.data.metrics,
    restored.data.metrics,
    "來源未變動不重算財務指標",
  );
  assert.notEqual(
    reused.data.coverage,
    restored.data.coverage,
    "載入狀態保持獨立避免污染快取",
  );
});
