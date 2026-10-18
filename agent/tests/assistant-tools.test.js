import test from "node:test";
import assert from "node:assert/strict";
import {
  createAssistantTools,
  assistantToolDefinitions,
} from "../assistant-tools.js";
import { skillCatalogue, readResearchSkill } from "../research-skills.js";
import { chatPrompt } from "../chat-adapter.js";
import { stockPriceValues } from "../price-evidence.js";

const stocks = [
  { market: "TWSE", symbol: "2330", name: "台積電" },
  { market: "TWSE", symbol: "2303", name: "聯電" },
  { market: "TWSE", symbol: "00927", name: "群益半導體收益" },
];
function harness() {
  const calls = [],
    requests = [];
  const context = {
    api_url: "http://localhost:8000",
    scope: {
      mode: "historical",
      as_of: "2026-10-17T00:00:00Z",
      start: "2026-10-01",
      end: "2026-10-16",
    },
    user_message: "台積電成本1000一張；聯電成本50兩張",
    known_targets: stocks.slice(0, 2),
  };
  const tools = createAssistantTools(context, {
    onCall: (c) => calls.push(c),
    fetcher: async (url, options) => {
      const u = new URL(url);
      requests.push(u.pathname + u.search);
      if (u.pathname === "/api/search")
        return Response.json(
          stocks.filter(
            (s) =>
              s.symbol === u.searchParams.get("q") ||
              s.name.includes(u.searchParams.get("q")),
          ),
        );
      if (u.pathname === "/api/research/report-input") {
        const body = JSON.parse(options.body),
          symbol = body.symbol,
          price = symbol === "2330" ? 1100 : 55;
        return Response.json({
          report: {
            meta: { asset: "stock", symbol },
            evidence: [
              { id: "price:last", category: "technical", value: price },
            ],
            metrics: { ma20: price },
            scenarios: [],
            observations: [],
            chart_annotations: [],
          },
          input: {
            bars: [
              {
                trade_date: "2026-10-16",
                open: price,
                high: price,
                low: price,
                close: price,
                volume: 1000,
                is_final: true,
              },
            ],
            quality: [],
            facets: [],
          },
        });
      }
      throw Error("不應查詢此路由 " + u.pathname);
    },
  });
  return { context, tools, calls, requests };
}
test("技能可按需讀取並保留版本，不執行行情或允許任意路徑", async () => {
  const { tools, calls, requests } = harness();
  const skills = await skillCatalogue();
  assert.equal(skills.length, 4);
  assert.equal(new Set(skills.map((s) => s.name)).size, 4);
  const skill = await tools.call("read_research_skill", {
    name: "twstock-compare",
  });
  assert.ok(skill.content.length > 200);
  assert.ok(skill.version);
  assert.equal(calls[0].category, "skill");
  assert.equal(requests.length, 0);
  await assert.rejects(readResearchSkill("../../.env"), /找不到/);
  const prompt = chatPrompt(
    { id: "s", mode: "latest", targets: [] },
    { message: "比較台積電與聯電" },
    skills,
  );
  assert.ok(prompt.includes("read_research_skill"));
  assert.ok(prompt.includes("twstock-compare"));
  assert.ok(!prompt.includes(skill.content));
});
test("依描述搜尋、多股查詢各自隔離，沒有Session選股預設且保留前導零", async () => {
  const { tools, calls } = harness();
  await assert.rejects(
    tools.call("get_stock_data", {
      market: "TWSE",
      symbol: "2330",
      section: "technical",
    }),
    /twstock-evidence/,
  );
  await tools.call("read_research_skill", { name: "twstock-evidence" });
  const found = await tools.call("search_stocks", { query: "群益半導體" });
  assert.equal(found.candidates[0].symbol, "00927");
  await assert.rejects(
    tools.call("get_stock_data", { section: "technical" }),
    /工具參數/,
  );
  await assert.rejects(
    tools.call("get_stock_data", {
      market: "TPEX",
      symbol: "2330",
      section: "technical",
    }),
    /不在平台目錄/,
  );
  const a = await tools.call("get_stock_data", {
    market: "TWSE",
    symbol: "2330",
    section: "technical",
  });
  const b = await tools.call("get_stock_data", {
    market: "TWSE",
    symbol: "2303",
    section: "technical",
  });
  assert.equal(a.data.bars.rows[0].close, 1100);
  assert.equal(b.data.bars.rows[0].close, 55);
  assert.notEqual(a.evidence_id, b.evidence_id);
  assert.equal(
    calls.find((c) => c.evidence_id === a.evidence_id).target.name,
    "台積電",
  );
  await assert.rejects(
    tools.call("calculate_trade_profit", {
      market: "TWSE",
      symbol: "2303",
      buy_price: 55,
      sell_price: 1100,
      shares: 2000,
    }),
    /不能自行編造/,
  );
  const report = await tools.call("save_research_report", {
    title: "兩家公司比較",
    markdown: "台積電與聯電的資料期間一致，仍須比較不同業務與風險。",
    evidence_ids: [a.evidence_id, b.evidence_id],
  });
  assert.ok(report.displayed);
  assert.equal(calls.at(-1).artifact.targets.length, 2);
  const mixed = stockPriceValues(
    {
      asset: "stock",
      evidence: [
        {
          data: { meta: { asset: "etf" }, bars: { rows: [{ close: 38.22 }] } },
        },
      ],
    },
    [],
    { executable: true },
  );
  assert.ok(mixed.has("38.22"));
});
test("多股成本須以原文歸屬，不能把另一檔部位或自編摘錄套入", async () => {
  const { tools } = harness();
  await tools.call("read_research_skill", { name: "twstock-evidence" });
  const args = {
    market: "TWSE",
    symbol: "2330",
    buy_price: 1000,
    sell_price: 1100,
    shares: 1000,
    buy_price_source: "user_cost",
  };
  await assert.rejects(tools.call("calculate_trade_profit", args), /多股持倉/);
  await assert.rejects(
    tools.call("calculate_trade_profit", {
      ...args,
      position_text: "台積電成本900一張",
    }),
    /原文/,
  );
  await assert.rejects(
    tools.call("calculate_trade_profit", {
      ...args,
      position_text: "聯電成本50兩張",
    }),
    /原文/,
  );
  const result = await tools.call("calculate_trade_profit", {
    ...args,
    position_text: "台積電成本1000一張",
  });
  assert.equal(result.data.gross_profit, 100000);
});
test("大盤及概念不需個股，獨立大盤工具不洩漏歷史截止後快照", async () => {
  const { tools, requests } = harness();
  await tools.call("read_research_skill", { name: "twstock-evidence" });
  await assert.rejects(tools.call("get_market_data", {}), /歷史截止/);
  assert.equal(requests.length, 0);
  assert.ok(assistantToolDefinitions.some((t) => t.name === "get_market_data"));
  const latest = createAssistantTools(
    {
      api_url: "http://localhost:8000",
      scope: { mode: "latest", end: "2026-10-18" },
    },
    {
      fetcher: async (url) =>
        Response.json({
          available: false,
          source_date: "2026-10-16",
          route: new URL(url).pathname,
        }),
    },
  );
  await latest.call("read_research_skill", { name: "twstock-evidence" });
  const result = await latest.call("get_market_data", {});
  assert.equal(result.category, "market");
  assert.ok(result.data.chips);
  assert.equal(result.symbol, undefined);
});
