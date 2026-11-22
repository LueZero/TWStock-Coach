// Exercises the actual Chat MCP implementation against the running stock API.
// Does not invoke Codex, create Sessions, write stock data or print credentials.
import assert from "node:assert/strict";
import { createAssistantTools } from "../agent/assistant-tools.js";

const end = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const start = new Date(Date.parse(end) - 60 * 86400000)
  .toISOString()
  .slice(0, 10);
const api = process.env.ASSISTANT_STOCK_API_URL || "http://127.0.0.1:8000";
const requests = [],
  results = [];
const tools = createAssistantTools(
  {
    api_url: api,
    scope: { mode: "latest", as_of: new Date().toISOString(), start, end },
  },
  {
    fetcher: async (url, options) => {
      const path = new URL(url).pathname;
      assert.ok(
        !/report-input|refresh|ingest|\/load|\/jobs/.test(path),
        "Chat called a legacy report or ingestion endpoint",
      );
      requests.push(path);
      return fetch(url, options);
    },
  },
);
async function run(name, args) {
  try {
    const value = await tools.call(name, args);
    const data = value.data || value;
    const summary = {
      tool: name,
      section: args.section || args.dataset || null,
      symbol: args.symbol || null,
      status: data.source_status || data.state || data.status || "returned",
      evidence: !!value.evidence_id,
      ...(data.bars ? { bars: data.bars.total } : {}),
      ...(data.catalogue ? { catalogue: data.catalogue.length } : {}),
    };
    results.push(summary);
    console.log(JSON.stringify(summary));
    return value;
  } catch (error) {
    results.push({ tool: name, section: args.section, error: error.message });
    console.error(JSON.stringify(results.at(-1)));
  }
}
await run("read_research_skill", { name: "twstock-evidence" });
await run("search_stocks", { query: "2409" });
const stock = { market: "TWSE", symbol: "2409" };
for (const section of ["basic", "technical", "financial", "chips", "peers"])
  await run("get_stock_data", { ...stock, section, limit: 5 });
await run("get_stock_data", {
  ...stock,
  section: "news",
  start: end,
  end,
  source: "recent",
});
await run("get_stock_quote", stock);
await run("run_strategy_backtest", {
  ...stock,
  start,
  end,
  fee_bps: 10,
  slippage_bps: 5,
  sell_tax_bps: 30,
});
await run("search_stocks", { query: "00927" });
await run("get_fund_data", {
  market: "TWSE",
  symbol: "00927",
  section: "nav",
  start,
  end,
  limit: 5,
});
assert.ok(requests.length > 0);
const failures = results.filter((row) => row.error);
console.log(
  JSON.stringify({
    mode: "source_api",
    request_count: requests.length,
    legacy_requests: 0,
    completed: results.length - failures.length,
    failed: failures.length,
    note: "Returned/updating/permission statuses do not prove complete source coverage. No Codex model was invoked.",
  }),
);
if (failures.length) process.exitCode = 1;
