import test from "node:test";
import assert from "node:assert/strict";
import { prepareReportInput } from "../report-input.js";
import { validateExplanation } from "../report-schema.js";
import { toolDefinitions, createStockTools } from "../tools.js";
import { validateAssistantInput } from "../../api/research-packet.js";
import { buildRuleReport } from "../../api/report-conditions.js";
const scope = {
  market: "TWSE",
  symbol: "2883",
  mode: "historical",
  start: "2026-01-01",
  end: "2026-10-08",
  as_of: "2026-10-08T10:00:00Z",
  context: {},
};
function fixtures() {
  const bars = Array.from({ length: 190 }, (_, i) => ({
    id: i,
    revision: 1,
    timestamp: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    trade_date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
    open: 30,
    high: 31,
    low: 29,
    close: 30,
    volume: 1000,
    is_final: true,
  }));
  return {
    input: {
      ...scope,
      bars,
      facets: [
        { id: "financial", state: "neutral" },
        { id: "news", state: "missing" },
      ],
      quality: [],
    },
    report: {
      meta: { ...scope, industry: "金融保險" },
      context: scope.context,
      metrics: { ma5: 30 },
      observations: [],
      chart_annotations: [],
      scenarios: [],
      plan_checks: [],
      evidence: [
        {
          id: "financial:eps",
          category: "financial",
          value: 0.95,
          assessment: { tone: "good" },
          source: [{ source: "test", received_at: scope.as_of }],
        },
        {
          id: "financial:history:per",
          category: "financial",
          rows: bars.map((b) => ({ period: b.trade_date, value: b.close })),
        },
        {
          id: "chips:institutions",
          category: "chips",
          rows: [{ date: "2026-10-08", foreign: 2000 }],
        },
      ],
    },
  };
}
const fetcher = async (url, options) => ({
  ok: true,
  json: async () =>
    String(url).includes("report-input")
      ? fixtures()
      : {
          profile: { company_name: "凱基金" },
          catalogue: { industry: "金融保險" },
          coverage: [],
          workspace: {
            institutions: fixtures().input.bars.map((b) => ({
              date: b.trade_date,
              foreign: 2000,
            })),
            tabs: [
              {
                id: "institutions",
                rows: fixtures().input.bars.map((b) => ({
                  date: b.trade_date,
                  foreign: 2000,
                })),
              },
            ],
          },
        },
});
test("模型啟動前整理所有面向，完整區間K線分頁合併，缺資料不補零", async () => {
  const value = await prepareReportInput(
    { api_url: "http://localhost:8000", scope },
    { fetcher },
  );
  assert.deepEqual(
    value.packet.manifest.map((s) => s.section),
    [
      "overview",
      "basic",
      "technical",
      "financial",
      "chips",
      "peers",
      "news",
      "market",
      "scenarios",
    ],
  );
  const technical = value.packet.sections.find(
    (s) => s.section === "technical",
  );
  assert.equal(technical.data.bars.rows.length, 190);
  const columns = technical.data.bars.columns;
  assert.equal(
    new Set(technical.data.bars.rows.map((r) => r[columns.indexOf("id")])).size,
    190,
  );
  assert.equal(
    technical.data.bars.rows[0][columns.indexOf("trade_date")],
    "2026-01-01",
  );
  assert.equal(
    value.packet.manifest.find((s) => s.section === "news").status,
    "missing",
  );
  const finance = value.packet.sections.find((s) => s.section === "financial");
  assert.equal(finance.evidence[0].value, 0.95);
  assert.equal(Object.hasOwn(finance.evidence[0], "assessment"), false);
  assert.equal(
    value.packet.source_catalogue[finance.evidence[0].source_ref][0].source,
    "test",
  );
  assert.equal(
    finance.evidence.find((e) => e.id.endsWith("financial:history:per")).rows
      .length,
    190,
  );
  const chipBlock = value.packet.sections.find((s) => s.section === "chips");
  assert.equal(chipBlock.data.workspace.institutions.rows.length, 190);
  assert.equal(chipBlock.data.workspace.tabs.rows[0].rows.length, 190);
  assert.equal(chipBlock.data.workspace.institutions.has_more, false);
  assert.ok(
    value.calls.every(
      (c) => c.as_of === scope.as_of && c.origin === "prepared_input",
    ),
  );
});

test("資料清單區分部分財務來源、長均線暖機不足及無有效同業", async () => {
  const snapshot = fixtures();
  snapshot.report.evidence.push(
    {
      id: "financial:coverage",
      category: "financial",
      rows: [
        { dataset: "income", status: "available" },
        { dataset: "cash", status: "no_data" },
      ],
    },
    {
      id: "peers:comparison",
      category: "peers",
      comparable_count: 0,
      rows: [{ selected: true, available: 1 }],
    },
  );
  const value = await prepareReportInput(
    { api_url: "http://localhost:8000", scope, snapshot },
    { fetcher },
  );
  const manifest = Object.fromEntries(
    value.packet.manifest.map((m) => [m.section, m.status]),
  );
  assert.equal(manifest.financial, "partial");
  assert.equal(manifest.technical, "partial");
  assert.equal(manifest.peers, "missing");
});
test("報告不注入本金、風險、費用與持倉；保留技術價位條件", () => {
  const validated = validateAssistantInput({
    ...scope,
    context: { capital: 100000, risk_budget: 2000, shares: 1000, cost: 30 },
  });
  assert.deepEqual(validated.context, {});
  const packet = {
    ...fixtures().input,
    context: validated.context,
    asset: "stock",
    name: "測試",
    evidence: [],
    expected_last_day: fixtures().input.bars.at(-1).trade_date,
    continuity_verified: true,
  };
  const report = buildRuleReport(packet);
  assert.deepEqual(report.context, {});
  assert.equal(report.holding, null);
  assert.ok(report.scenarios.length);
  assert.ok(
    report.scenarios.every(
      (s) =>
        !Object.hasOwn(s, "max_shares") && !Object.hasOwn(s, "risk_at_stop"),
    ),
  );
  assert.ok(report.plan_checks.every((c) => c.id !== "risk"));
});
test("補查僅保留資料工具，預先準備中取消會停止查詢", async () => {
  assert.deepEqual(
    toolDefinitions.map((t) => t.name),
    [
      "calculate_trade_profit",
      "get_stock_data",
      "get_financial_history",
      "get_chip_detail",
    ],
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () =>
      prepareReportInput(
        { api_url: "http://localhost:8000", scope },
        { fetcher, signal: controller.signal },
      ),
    /取消/,
  );
});
test("AI摘要與全文皆驗證本次數值及引用，舊報告仍可讀取", () => {
  const report = {
    evidence: [{ id: "tool:test", data: { price: 37.55 } }],
    scenarios: [],
  };
  const value = {
    summary: "本次價格37.55元，觀察條件。",
    answer: "依據本次行情分析。",
    highlights: [{ text: "行情依據", evidence_ids: ["tool:test"] }],
    scenario_ids: [],
    cautions: [],
  };
  assert.equal(validateExplanation(value, report).summary, value.summary);
  assert.throws(() =>
    validateExplanation({ ...value, summary: "建議價格9999元。" }, report),
  );
  assert.doesNotThrow(() =>
    validateExplanation(
      { ...value, summary: "你提供成本36元；本金100000元。" },
      { ...report, user_message: "本金10萬，成本36元" },
    ),
  );
  const { summary, ...legacy } = value;
  assert.doesNotThrow(() => validateExplanation(legacy, report));
});
test("AI可自選起日補查，固定截止；手動期間及不合法日期不可改", async () => {
  const bodies = [],
    calls = [];
  const tools = createStockTools(
    {
      api_url: "http://localhost:8000",
      scope: { ...scope, range_mode: "auto" },
    },
    {
      fetcher: async (url, options) => {
        if (options.body) bodies.push(JSON.parse(options.body));
        return fetcher(url, options);
      },
      onCall: async (c) => calls.push(c),
    },
  );
  const result = await tools.call("get_stock_data", {
    section: "technical",
    start: "2026-06-01",
  });
  assert.equal(result.start, "2026-06-01");
  assert.equal(result.as_of, scope.as_of);
  assert.equal(bodies[0].start, "2026-06-01");
  assert.equal(bodies[0].as_of, scope.as_of);
  assert.equal(calls[0].arguments.start, "2026-06-01");
  await assert.rejects(
    () =>
      tools.call("get_stock_data", {
        section: "technical",
        start: "2026-02-30",
      }),
    /有效日期/,
  );
  await assert.rejects(
    () =>
      tools.call("get_stock_data", {
        section: "technical",
        start: "2026-10-09",
      }),
    /有效日期/,
  );
  await assert.rejects(
    () =>
      tools.call("get_stock_data", {
        section: "technical",
        start: "2024-01-01",
      }),
    /有效日期/,
  );
  const manual = createStockTools(
    {
      api_url: "http://localhost:8000",
      scope: { ...scope, range_mode: "manual" },
    },
    { fetcher },
  );
  await assert.rejects(
    () =>
      manual.call("get_stock_data", {
        section: "technical",
        start: "2026-06-01",
      }),
    /指定固定期間/,
  );
});
test("新手報告卡片逐項驗證證據、價位和實際查詢期間", () => {
  const report = {
    evidence: [{ id: "tool:test", data: { price: 37.55 } }],
    scenarios: [],
    query_windows: [{ start: scope.start, end: scope.end }],
  };
  const value = {
    summary: "先等走勢改善。",
    answer: "目前可先觀察。",
    highlights: [],
    scenario_ids: [],
    cautions: [],
    analysis_windows: [
      { start: scope.start, end: scope.end, purpose: "核對中期價格趨勢" },
    ],
    sections: [
      "technical",
      "basic",
      "financial",
      "chips",
      "peers",
      "news",
      "market",
    ].map((id) => ({
      id,
      title: "面向判讀",
      takeaway: "資料顯示需要等待。",
      reason: "完成日K價格37.55元。",
      watch: "若價量改善再核對。",
      evidence_ids: ["tool:test"],
    })),
    action_plan: ["entry", "holding", "exit"].map((id) => ({
      id,
      condition: "完成收盤確認。",
      action: "核對量價後再評估。",
      invalidation: "原本支持理由消失需重評估。",
      evidence_ids: ["tool:test"],
    })),
  };
  assert.doesNotThrow(() => validateExplanation(value, report));
  assert.throws(
    () =>
      validateExplanation(
        {
          ...value,
          analysis_windows: [
            { start: "2025-01-01", end: scope.end, purpose: "未查期間" },
          ],
        },
        report,
      ),
    /分析期間/,
  );
  assert.throws(
    () =>
      validateExplanation(
        {
          ...value,
          sections: value.sections.map((s, i) =>
            i ? s : { ...s, watch: "買進價格9999元。" },
          ),
        },
        report,
      ),
    /非平台計算價位/,
  );
  assert.throws(
    () =>
      validateExplanation(
        {
          ...value,
          action_plan: value.action_plan.map((s, i) =>
            i ? s : { ...s, evidence_ids: ["tool:fake"] },
          ),
        },
        report,
      ),
    /有效證據/,
  );
});
