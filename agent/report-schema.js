export const explanationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    highlights: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          evidence_ids: { type: "array", items: { type: "string" } },
        },
        required: ["text", "evidence_ids"],
      },
    },
    scenario_ids: { type: "array", items: { type: "string" } },
    cautions: { type: "array", items: { type: "string" } },
  },
  required: ["answer", "highlights", "scenario_ids", "cautions"],
};
export function validateExplanation(value, report) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (k) => !["answer", "highlights", "scenario_ids", "cautions"].includes(k),
    )
  )
    throw Error("AI回覆格式不符");
  const text = (v) => typeof v === "string" && v.length > 0 && v.length <= 6000;
  if (
    !text(value.answer) ||
    !Array.isArray(value.highlights) ||
    value.highlights.length > 8 ||
    !Array.isArray(value.scenario_ids) ||
    value.scenario_ids.length > 4 ||
    !Array.isArray(value.cautions) ||
    value.cautions.length > 8 ||
    !value.cautions.every(text)
  )
    throw Error("AI回覆內容長度或結構不符");
  const ids = new Set(report.evidence.map((e) => e.id)),
    scenarios = new Set(report.scenarios.map((s) => s.id));
  for (const h of value.highlights)
    if (
      !h ||
      Object.keys(h).some((k) => !["text", "evidence_ids"].includes(k)) ||
      !text(h.text) ||
      !Array.isArray(h.evidence_ids) ||
      !h.evidence_ids.length ||
      h.evidence_ids.length > 8 ||
      !h.evidence_ids.every((id) => ids.has(id))
    )
      throw Error("AI引用不存在或缺少證據");
  if (!value.scenario_ids.every((id) => scenarios.has(id)))
    throw Error("AI引用不存在的交易情境");
  const allowed = new Set();
  const collect = (v) => {
    if (typeof v === "number" && Number.isFinite(v)) {
      allowed.add(String(v));
      allowed.add(v.toFixed(2));
      allowed.add(String(Number(v.toFixed(4))));
      allowed.add(v.toFixed(1));
      allowed.add(String(Math.round(v)));
    } else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v))
        if (
          !["revisions", "source", "revision", "snapshot_id", "id"].includes(k)
        )
          collect(x);
  };
  collect(report.metrics);
  collect(report.scenarios);
  collect(report.holding);
  collect(report.evidence);
  for (const s of [
    value.answer,
    ...value.highlights.map((h) => h.text),
    ...value.cautions,
  ]) {
    const assertions = s.replace(
      /(?:不(?:能|會|可|作)?|無法|未|沒有|並非|不能提供)\s*保證.{0,6}(?:獲利|賺|上漲)/g,
      "",
    );
    if (/保證.{0,6}(獲利|賺|上漲)|勝率\s*\d|獲利機率\s*\d/.test(assertions))
      throw Error("AI回覆含未驗證獲利承諾");
    for (const m of s.matchAll(
      /(?:NT\$|新台幣|價格|價位|停損|停利|目標價|支撐|壓力)\s*[：:為在約]?\s*([\d,]+(?:\.\d+)?)\s*(?:元)?|([\d,]+(?:\.\d+)?)\s*元/g,
    ))
      if (!allowed.has((m[1] || m[2]).replaceAll(",", "")))
        throw Error("AI回覆含非平台計算價位");
  }
  return value;
}
export function compactReport(report) {
  const round = (value) =>
    typeof value === "number" ? Number(value.toFixed(4)) : value;
  const shorten = (value) => {
    if (typeof value === "number") return round(value);
    if (typeof value === "string") return value.slice(0, 220);
    if (Array.isArray(value)) return value.slice(-3).map(shorten);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(
            ([key]) =>
              ![
                "source_url",
                "revisions",
                "source",
                "assessment",
                "note",
                "source_revisions",
              ].includes(key),
          )
          .map(([key, v]) => [key, shorten(v)]),
      );
    return value;
  };
  return {
    meta: report.meta,
    id: report.id,
    status: report.status,
    status_label: report.status_label,
    summary: report.summary,
    metrics: shorten(report.metrics),
    facets: report.facets,
    scenarios: report.scenarios,
    holding: report.holding,
    context: report.context,
    quality: report.quality,
    limitations: report.limitations,
    evidence: report.evidence.map((e) => ({
      ...Object.fromEntries(
        Object.entries(e)
          .filter(
            ([key]) =>
              ![
                "revisions",
                "source",
                "rows",
                "fields",
                "url",
                "comparison",
                "assessment",
              ].includes(key),
          )
          .map(([key, value]) => [key, shorten(value)]),
      ),
      ...(e.rows
        ? {
            rows: shorten(e.rows),
            rows_note: `摘取 ${Math.min(3, e.rows.length)}／${e.rows.length} 筆；完整明細在平台報告。`,
          }
        : {}),
      ...(e.comparison ? { comparison: shorten(e.comparison) } : {}),
    })),
  };
}
