import { validateExplanation } from "./report-schema.js";

// Preflight and final acceptance must validate the same current-run evidence.
// Failed calls, old report evidence and the preflight result are not evidence.
export function validationReport(calls, fallback, message) {
  if (!calls.length) return { ...fallback, user_message: message };
  const fresh = calls.filter((c) => c.status === "completed" && c.evidence_id);
  const technical = fresh.find((c) => c.arguments.section === "technical");
  const scenario = fresh.find((c) => c.arguments.section === "scenarios");
  return {
    asset:
      fresh.find((c) => c.arguments.section === "overview")?.data.meta?.asset ||
      fallback.meta?.asset ||
      fallback.asset,
    evidence: fresh.flatMap((c) => [
      { id: c.evidence_id, data: c.data },
      ...(c.evidence || []),
    ]),
    metrics: technical?.data.metrics || {},
    scenarios: scenario?.data.scenarios || [],
    holding: scenario?.data.holding,
    observations: technical?.data.observations || [],
    chart_bars: [],
    user_message: message,
    query_windows: fresh.map((c) => ({ start: c.start, end: c.end })),
  };
}

export const validationToolDefinition = {
  name: "validate_report_draft",
  description:
    "提交完整報告JSON草稿，使用與正式交卷相同的證據、引用、價位及損益檢核。回傳valid與錯誤位置；失敗時在本次Codex分析內補查、試算或改寫後再檢查。此工具不產生市場證據、不保存正式報告，不能引用為證據。最後輸出前必須呼叫，並輸出通過的同一份內容。",
  inputSchema: {
    type: "object",
    properties: { report_json: { type: "string", maxLength: 60000 } },
    required: ["report_json"],
    additionalProperties: false,
  },
};

export function checkReportDraft(args, calls, fallback, message) {
  try {
    if (
      !args ||
      Object.keys(args).length !== 1 ||
      typeof args.report_json !== "string" ||
      args.report_json.length > 60000
    )
      throw Error("需提供完整報告JSON，長度上限60000字");
    validateExplanation(
      JSON.parse(args.report_json),
      validationReport(calls, fallback, message),
    );
    return {
      valid: true,
      note: "草稿通過，請輸出相同內容；正式保存前仍會再次檢核。",
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message,
      detail: error.validation_detail || null,
      instruction:
        "請核對本次工具證據。金額需有對應試算及正負方向；不要刪改數字以規避檢核。修正草稿後再呼叫本工具。",
    };
  }
}
