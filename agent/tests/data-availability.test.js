import test from "node:test";
import assert from "node:assert/strict";
import {
  annotateFinancialAvailability,
  sourceObservation,
} from "../../api/data-availability.js";
import { summarize } from "../../api/fundamentals.js";
import { directFinancial } from "../../api/direct-data.js";
import { companyProfile, FinMind } from "../../api/providers.js";
import { clearSourceCache, cachedResources } from "../../api/source-cache.js";
import { report as peerReport } from "../../api/peers.js";

test("ETF 同業頁不把公司財報標成待載入，避免無效查詢", async () => {
  const data = await peerReport(
    "TWSE",
    "00927",
    "2026-11-20",
    "latest",
    "common",
    null,
    null,
    {
      instruments: async () => [
        { market: "TWSE", symbol: "00927", name: "ETF", industry: "ETF" },
      ],
      snapshots: async () => [],
    },
  );
  assert.equal(data.rows[0].load_required, false);
  assert.ok(
    Object.values(data.rows[0].metrics).every(
      (m) => m.status === "not_applicable",
    ),
  );
});

test("來源成功但計算缺條件、來源空資料、權限與等待分開；真實零值仍可用", () => {
  const base = {
    metrics: [
      { key: "zero", value: 0 },
      {
        key: "ratio",
        label: "比率",
        value: null,
        datasets: ["income"],
        note: "分母須有效",
      },
      { key: "pe", value: null, datasets: ["per"] },
    ],
    coverage: [
      { dataset: "income", status: "available" },
      { dataset: "per", status: "no_data" },
    ],
    catalog: {
      groups: [
        {
          id: "a",
          label: "類別",
          pages: [
            { id: "ratio", keys: ["ratio"], status: "no_data" },
            {
              id: "nav",
              keys: [],
              requires: "需流通股數",
              status: "dependency_missing",
            },
          ],
        },
      ],
    },
  };
  const data = annotateFinancialAvailability(base, "2409");
  assert.equal(data.availability.metrics_available, 1);
  assert.equal(
    data.availability.metric_gaps[0].status,
    "calculation_unavailable",
  );
  assert.equal(data.availability.metric_gaps[1].status, "source_empty");
  assert.match(
    data.catalog.groups[0].pages[1].availability_reason,
    /不代表 API 拒絕權限/,
  );
  assert.equal(base.metrics[1].availability, undefined);
  for (const status of ["loading", "permission_denied", "quota_exceeded"]) {
    const checked = annotateFinancialAvailability(
      { ...base, coverage: [{ dataset: "income", status }] },
      "2409",
    );
    assert.equal(checked.availability.metric_gaps[0].status, status);
  }
});

test("ETF公司指標不適用，配息和文件入口仍保留", () => {
  const data = annotateFinancialAvailability(
    {
      metrics: [],
      coverage: [],
      catalog: {
        groups: [
          {
            pages: [
              { id: "profit", keys: [], kind: "metrics", status: "no_data" },
              {
                id: "dividend",
                keys: [],
                kind: "dividends",
                status: "available",
              },
              { id: "docs", keys: [], kind: "documents", status: "reference" },
            ],
          },
        ],
      },
    },
    "00927",
  );
  assert.deepEqual(
    data.catalog.groups[0].pages.map((p) => p.status),
    ["not_applicable", "available", "reference"],
  );
});

test("一年內到期長期負債核對來源別名，不把缺欄位補成零", () => {
  const base = {
    TaiwanStockBalanceSheet: [
      {
        date: "2026-09-30",
        type: "LongtermLiabilitiesCurrentPortion",
        value: 12345,
      },
    ],
  };
  assert.equal(
    summarize(base, "2026-11-20", false).metrics.find(
      (m) => m.key === "current_long_debt",
    ).value,
    12345,
  );
  assert.equal(
    summarize(
      {
        TaiwanStockBalanceSheet: [
          { date: "2026-09-30", type: "TotalAssets", value: 1000 },
        ],
      },
      "2026-11-20",
      false,
    ).metrics.find((m) => m.key === "current_long_debt").value,
    null,
  );
});

test("ETF只查配息來源，官方基本資料依基金代號精確匹配", async (t) => {
  clearSourceCache();
  const calls = [];
  t.mock.method(FinMind.prototype, "get", async (dataset) => {
    calls.push(dataset);
    return [
      {
        stock_id: "00927",
        date: "2026-11-01",
        CashEarningsDistribution: 1,
        StockEarningsDistribution: 0,
      },
    ];
  });
  await directFinancial("TWSE", "00927");
  await Promise.all(cachedResources().map((e) => e.promise));
  const data = (await directFinancial("TWSE", "00927")).data;
  assert.deepEqual(calls, ["TaiwanStockDividend"]);
  assert.equal(
    data.coverage.filter((r) => r.status === "not_applicable").length,
    6,
  );
  assert.equal(data.instrument_type, "etf");
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.match(String(url), /t187ap47_L/);
    return Response.json([
      { 基金代號: "009270", 基金中文名稱: "其他基金" },
      { 基金代號: "00927", 基金中文名稱: "測試基金" },
    ]);
  });
  const profile = await companyProfile("TWSE", "00927");
  assert.equal(profile[0].profile["基金中文名稱"], "測試基金");
  assert.equal(profile[0].instrument_type, "etf");
});

test("來源筆數、資料日期與最新週／最新持股口徑可追溯", () => {
  assert.deepEqual(
    sourceObservation("TaiwanStockHoldingSharesPer", "tdcc", [
      { date: "2026-11-13" },
      { date: "2026-11-13" },
    ]),
    {
      rows: 2,
      data_start: "2026-11-13",
      data_end: "2026-11-13",
      scope: "latest_week",
    },
  );
  assert.equal(
    sourceObservation("DirectorHoldingsReport", "twse", []).scope,
    "latest_position",
  );
  assert.equal(sourceObservation("some", "finmind", []).data_end, null);
});
