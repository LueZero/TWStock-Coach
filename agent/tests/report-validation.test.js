import test from "node:test";
import assert from "node:assert/strict";
import { calculateTrade } from "../trade-math.js";
import { validateExplanation } from "../report-schema.js";
import { checkReportDraft, validationReport } from "../report-validation.js";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const message = "40.60一張，另外38.30一張";
const snapshot = {
  report: {
    asset: "etf",
    evidence: [],
    chart_bars: [{ close: 38.22, high: 40.6, open: 38.3 }],
    scenarios: [],
  },
  input: { bars: [] },
};
const calls = [40.6, 38.3].map((buy_price, i) => ({
  name: "calculate_trade_profit",
  arguments: { buy_price, sell_price: 38.22, shares: 1000 },
  status: "completed",
  evidence_id: `tool:loss${i}`,
  data: calculateTrade(
    { buy_price, sell_price: 38.22, shares: 1000 },
    snapshot,
    message,
  ),
}));
calls.push({
  name: "get_stock_data",
  arguments: { section: "technical" },
  status: "completed",
  evidence_id: "tool:technical",
  data: {
    bars: { rows: snapshot.report.chart_bars },
    metrics: { volume: 2380 },
  },
});
const report = validationReport(calls, snapshot.report, message);
const answer = (text) => ({
  answer: text,
  highlights: [],
  scenario_ids: [],
  cautions: [],
});

test("00927兩筆虧損：並列、分別為、千分位與負號共用經濟方向", () => {
  for (const text of [
    "毛損失2,380元；另一筆毛損失80元。",
    "兩筆的毛損失分別為2,380元與80元，未扣費用。",
    "兩筆虧損各為2380元、80元。",
    "毛損益分別為－2,380元及−80元。",
    "每股價差－2.38元、毛損失2,380元。",
    "每股損失2.38元；另筆每股損失0.08元。",
    "按38.22元試算，兩筆各1,000股的毛損失分別為2,380元與80元，未含配息及費用。",
  ])
    assert.doesNotThrow(() => validateExplanation(answer(text), report), text);
});

test("個人損益只接受對應試算維度，不以成交量、成本或舊證據湊出金額", () => {
  for (const text of [
    "毛利2,380元。",
    "毛損失2,300元。",
    "淨損失2,380元。",
    "每股價差2380元。",
    "毛損失2.38元。",
    "買入價2380元。",
    "毛損失2380元；另一筆毛利80元。",
  ])
    assert.throws(
      () => validateExplanation(answer(text), report),
      /非平台計算價位/,
      text,
    );
  const noCalculation = validationReport(
    calls.filter((c) => c.name !== "calculate_trade_profit"),
    {
      evidence: calls.map((c) => ({ id: c.evidence_id, data: c.data })),
    },
    message,
  );
  assert.throws(
    () => validateExplanation(answer("毛損失2380元。"), noCalculation),
    /非平台計算價位/,
  );
  const failed = validationReport(
    calls.map((c) => ({ ...c, status: "failed" })),
    snapshot.report,
    message,
  );
  assert.throws(
    () => validateExplanation(answer("毛損失2380元。"), failed),
    /非平台計算價位/,
  );
});

test("損益語境不跨新子句污染股價、技術動能或財報數字", () => {
  const r = {
    ...report,
    evidence: [...report.evidence, { id: "technical:macd", value: -0.5166 }],
  };
  for (const text of [
    "毛損失2,380元，但40.60元是原始成本。",
    "毛損失2,380元；買入價38.30元僅為情境。",
    "MACD用快慢均價差看動能，柱值為負0.5166元。",
  ])
    assert.doesNotThrow(() => validateExplanation(answer(text), r));
  assert.throws(
    () => validateExplanation(answer("兩筆各一張，價差合計2380元。"), r),
    /非平台計算價位/,
  );
});

test("草稿預檢與正式保存共用驗證器，可回饋錯誤再以原始證據修正", () => {
  const invalid = answer("毛利2,380元。");
  const result = checkReportDraft(
    { report_json: JSON.stringify(invalid) },
    calls,
    snapshot.report,
    message,
  );
  assert.equal(result.valid, false);
  assert.equal(result.detail.kind, "gross");
  assert.equal(result.detail.number, 2380);
  const valid = answer("毛損失分別為2,380元與80元。");
  assert.equal(
    checkReportDraft(
      { report_json: JSON.stringify(valid) },
      calls,
      snapshot.report,
      message,
    ).valid,
    true,
  );
  assert.doesNotThrow(() => validateExplanation(valid, report));
  assert.equal(
    checkReportDraft({ report_json: "{" }, calls, snapshot.report, message)
      .valid,
    false,
  );
  assert.equal(
    checkReportDraft(
      {
        report_json: JSON.stringify({
          ...valid,
          highlights: [{ text: "試算", evidence_ids: ["tool:fake"] }],
        }),
      },
      calls,
      snapshot.report,
      message,
    ).valid,
    false,
  );
});

test("實際MCP子程序提供草稿檢核，讀取當次稽核並回饋修正，不把檢核當新證據", async () => {
  const directory = await mkdtemp(join(tmpdir(), "twstock-preflight-test-"));
  const auditPath = join(directory, "audit.jsonl");
  const contextPath = join(directory, "context.json");
  const audit = calls.map((c) => JSON.stringify(c)).join("\n") + "\n";
  await writeFile(auditPath, audit);
  await writeFile(
    contextPath,
    JSON.stringify({
      api_url: "http://127.0.0.1:8000",
      snapshot,
      user_message: message,
      audit_path: auditPath,
      scope: {
        market: "TWSE",
        symbol: "00927",
        mode: "historical",
        as_of: "2026-10-17T17:01:12Z",
      },
    }),
  );
  const client = new Client({ name: "regression-test", version: "1.0.0" });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [
          fileURLToPath(new URL("../mcp-server.js", import.meta.url)),
          contextPath,
        ],
        stderr: "pipe",
      }),
    );
    assert.ok(
      (await client.listTools()).tools.some(
        (t) => t.name === "validate_report_draft",
      ),
    );
    for (const [text, valid] of [
      ["毛利2380元。", false],
      ["毛損失分別為2,380元與80元。", true],
    ]) {
      const response = await client.callTool({
        name: "validate_report_draft",
        arguments: { report_json: JSON.stringify(answer(text)) },
      });
      assert.equal(JSON.parse(response.content[0].text).valid, valid);
    }
    assert.equal(await readFile(auditPath, "utf8"), audit);
  } finally {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
