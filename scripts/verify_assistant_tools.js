// All registered Chat tools against the running API, without invoking Codex.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import {
  createAssistantTools,
  assistantToolDefinitions,
} from "../agent/assistant-tools.js";
try {
  process.loadEnvFile();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const end = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const before = (days) =>
  new Date(Date.parse(end) - days * 86400000).toISOString().slice(0, 10);
const start = before(60),
  api = process.env.ASSISTANT_STOCK_API_URL || "http://127.0.0.1:8000";
const requests = [],
  results = [],
  evidence = [],
  exercised = new Set();
const tools = createAssistantTools(
  {
    api_url: api,
    user_message: "工具驗證假設友達一張，非使用者實際持倉。",
    scope: { mode: "latest", as_of: new Date().toISOString(), start, end },
  },
  {
    fetcher: async (url, options) => {
      const path = new URL(url).pathname;
      assert.ok(
        !/report-input|refresh|ingest|\/load|\/jobs/.test(path),
        "Legacy report/ingestion endpoint",
      );
      requests.push(path);
      return fetch(url, options);
    },
  },
);
async function run(name, args = {}) {
  exercised.add(name);
  try {
    const value = await tools.call(name, args),
      data = value.data || value;
    const status =
      data.dataset_status ||
      data.source_status ||
      data.source_state ||
      data.state ||
      data.status ||
      (data.ready === false ? "service_unavailable" : "returned");
    const summary = {
      tool: name,
      section: args.section || args.dataset || args.metric || args.page,
      symbol: args.symbol,
      status,
      evidence: !!value.evidence_id,
      endpoint: value.endpoint,
      ...(data.bars ? { bars: data.bars.total } : {}),
      ...(data.catalogue ? { catalogue: data.catalogue.length } : {}),
    };
    results.push(summary);
    if (value.evidence_id) evidence.push(value.evidence_id);
    console.log(JSON.stringify(summary));
    return value;
  } catch (error) {
    results.push({
      tool: name,
      section: args.section || args.dataset,
      error: error.message,
      code: error.code,
    });
    console.error(JSON.stringify(results.at(-1)));
  }
}
const service = await run("get_stock_service_status");
if (!service?.ready) {
  console.error("股票API未就緒；停止驗證，不將連線失敗當成來源無資料。");
  process.exit(1);
}
await run("list_research_skills");
await run("read_research_skill", { name: "twstock-evidence" });
await run("search_stocks", { query: "2409" });
const stock = { market: "TWSE", symbol: "2409" };
for (const section of [
  "overview",
  "basic",
  "technical",
  "financial",
  "chips",
  "peers",
  "market",
])
  await run("get_stock_data", { ...stock, section, limit: 5 });
await run("get_stock_data", {
  ...stock,
  section: "news",
  start: end,
  end,
  source: "recent",
});
await run("get_stock_data", {
  ...stock,
  section: "news",
  start: end,
  end,
  source: "index",
});
await run("get_stock_quote", stock);
const finance = await run("get_financial_history", {
  ...stock,
  wait_ms: 15000,
});
const metric = finance?.data?.catalogue?.find((m) => m.value != null)?.key;
if (metric) await run("get_financial_history", { ...stock, metric, limit: 5 });
const financialPage = finance?.data?.catalog?.groups
  ?.flatMap((g) => g.pages)
  .find((p) => p.available_metrics > 0);
if (financialPage)
  await run("get_financial_history", {
    ...stock,
    page: financialPage.id,
    limit: 5,
  });
const chips = await run("get_chip_detail", { ...stock, wait_ms: 15000 });
for (const page of chips?.data?.catalogue || [])
  await run("get_chip_detail", { ...stock, dataset: page.id, limit: 3 });
await run("get_market_data");
await run("get_market_chart", {
  product: "index",
  mode: "history",
  start: before(6),
  end,
});
await run("screen_market_stocks", {
  market: "ALL",
  asset: "stock",
  limit: 3,
  sort_by: "turnover",
  order: "desc",
});
const technical = await run("get_stock_data", {
  ...stock,
  section: "technical",
  limit: 1,
});
const close = technical?.data?.bars?.rows?.at(-1)?.close;
if (close != null)
  await run("calculate_trade_profit", {
    ...stock,
    buy_price: close,
    sell_price: close,
    shares: 1000,
  });
await run("show_stock_chart", stock);
await run("run_strategy_backtest", {
  ...stock,
  start,
  end,
  fee_bps: 10,
  slippage_bps: 5,
  sell_tax_bps: 30,
});
await run("get_valuation_bands", {
  ...stock,
  field: "PER",
  start,
  end,
  limit: 3,
});
await run("search_stocks", { query: "00878" });
for (const section of ["nav", "portfolio", "quarterly"])
  await run("get_fund_data", {
    market: "TWSE",
    symbol: "00878",
    section,
    start,
    end,
    limit: 3,
  });
await run("get_fund_data", {
  ...stock,
  section: "holders",
  start,
  end,
  limit: 3,
});
if (evidence.length)
  await run("save_research_report", {
    title: "工具連線驗證",
    markdown:
      "此為工具驗證，不含投資結論。來源可能仍在載入、部分可用或受權限限制，須逐項核對。",
    evidence_ids: evidence.slice(-20),
  });
assert.ok(requests.length > 0);
const failures = results.filter((row) => row.error);
const latest = new Map(
  results.map((row) => [
    row.endpoint || `${row.tool}:${row.section || ""}`,
    row,
  ]),
);
const pending = [...latest.values()].filter((row) =>
  ["updating", "loading", "queued"].includes(row.status),
);
const notExercised = assistantToolDefinitions
  .filter((tool) => !exercised.has(tool.name))
  .map((tool) => tool.name);
const summary = {
  mode: "source_api",
  registered_tools: assistantToolDefinitions.length,
  request_count: requests.length,
  legacy_requests: 0,
  failed: failures.length,
  pending: pending.length,
  restricted: results
    .filter((row) =>
      [
        "permission_denied",
        "requires_token",
        "not_configured",
        "not_connected",
        "outside_range",
        "no_data",
      ].includes(row.status),
    )
    .map(({ tool, section, status }) => ({ tool, section, status })),
  not_exercised: notExercised,
  note: "HTTP/tool success is not proof of complete source coverage. Partial/permission/empty states must be checked separately. No Codex was invoked and artifacts are not written to user Sessions.",
};
await mkdir(".tmp", { recursive: true });
await writeFile(
  ".tmp/assistant-tools-audit-latest.json",
  JSON.stringify({ summary, results }, null, 2),
);
console.log(JSON.stringify(summary));
if (failures.length || pending.length || notExercised.length)
  process.exitCode = 1;
