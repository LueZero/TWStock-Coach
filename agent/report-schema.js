export const explanationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    answer: { type: "string" },
    analysis_windows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          start: { type: "string" },
          end: { type: "string" },
          purpose: { type: "string" },
        },
        required: ["start", "end", "purpose"],
      },
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: {
            type: "string",
            enum: [
              "technical",
              "basic",
              "financial",
              "chips",
              "peers",
              "news",
              "market",
            ],
          },
          title: { type: "string" },
          takeaway: { type: "string" },
          reason: { type: "string" },
          watch: { type: "string" },
          evidence_ids: { type: "array", items: { type: "string" } },
        },
        required: [
          "id",
          "title",
          "takeaway",
          "reason",
          "watch",
          "evidence_ids",
        ],
      },
    },
    action_plan: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", enum: ["entry", "holding", "exit"] },
          condition: { type: "string" },
          action: { type: "string" },
          invalidation: { type: "string" },
          evidence_ids: { type: "array", items: { type: "string" } },
        },
        required: ["id", "condition", "action", "invalidation", "evidence_ids"],
      },
    },
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
  required: [
    "summary",
    "answer",
    "analysis_windows",
    "sections",
    "action_plan",
    "highlights",
    "scenario_ids",
    "cautions",
  ],
};
export function validateExplanation(value, report) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (k) =>
        ![
          "summary",
          "answer",
          "highlights",
          "scenario_ids",
          "cautions",
          "analysis_windows",
          "sections",
          "action_plan",
        ].includes(k),
    )
  )
    throw Error("AI回覆格式不符");
  const text = (v) => typeof v === "string" && v.length > 0 && v.length <= 6000;
  if (
    !text(value.answer) ||
    (value.summary !== undefined && !text(value.summary)) ||
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
  const refs = (list) =>
    Array.isArray(list) &&
    list.length > 0 &&
    list.length <= 8 &&
    list.every((id) => ids.has(id));
  if (value.sections !== undefined) {
    const expected = [
      "technical",
      "basic",
      "financial",
      "chips",
      "peers",
      "news",
      "market",
    ];
    if (
      !Array.isArray(value.sections) ||
      value.sections.length !== 7 ||
      new Set(value.sections.map((s) => s?.id)).size !== 7 ||
      !value.sections.every(
        (s) =>
          s &&
          expected.includes(s.id) &&
          [s.title, s.takeaway, s.reason, s.watch].every(text) &&
          refs(s.evidence_ids) &&
          Object.keys(s).every((k) =>
            [
              "id",
              "title",
              "takeaway",
              "reason",
              "watch",
              "evidence_ids",
            ].includes(k),
          ),
      )
    )
      throw Error("AI面向卡片缺少內容或有效證據");
  }
  if (value.action_plan !== undefined) {
    if (
      !Array.isArray(value.action_plan) ||
      value.action_plan.length !== 3 ||
      new Set(value.action_plan.map((s) => s?.id)).size !== 3 ||
      !value.action_plan.every(
        (s) =>
          s &&
          ["entry", "holding", "exit"].includes(s.id) &&
          [s.condition, s.action, s.invalidation].every(text) &&
          refs(s.evidence_ids) &&
          Object.keys(s).every((k) =>
            [
              "id",
              "condition",
              "action",
              "invalidation",
              "evidence_ids",
            ].includes(k),
          ),
      )
    )
      throw Error("AI進出場觀察缺少內容或有效證據");
  }
  if (value.analysis_windows !== undefined) {
    const windows = report.query_windows || [];
    if (
      !Array.isArray(value.analysis_windows) ||
      !value.analysis_windows.length ||
      value.analysis_windows.length > 4 ||
      !value.analysis_windows.every(
        (w) =>
          w &&
          text(w.purpose) &&
          windows.some((q) => q.start === w.start && q.end === w.end) &&
          Object.keys(w).every((k) => ["start", "end", "purpose"].includes(k)),
      )
    )
      throw Error("AI引用未實際查詢的分析期間");
  }
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
  collect(report.observations);
  collect(report.chart_bars);
  // User-provided amounts are personal assumptions, not market evidence.
  // Permit restating them without manufacturing a platform position/default.
  for (const match of String(report.user_message || "").matchAll(
    /([+-]?\d+(?:,\d{3})*(?:\.\d+)?)\s*([萬億]?)/g,
  ))
    collect(
      Number(match[1].replaceAll(",", "")) *
        (match[2] === "萬" ? 10000 : match[2] === "億" ? 100000000 : 1),
    );
  for (const s of [
    ...(value.summary ? [value.summary] : []),
    value.answer,
    ...value.highlights.map((h) => h.text),
    ...value.cautions,
    ...(value.sections || []).flatMap((s) => [
      s.title,
      s.takeaway,
      s.reason,
      s.watch,
    ]),
    ...(value.action_plan || []).flatMap((s) => [
      s.condition,
      s.action,
      s.invalidation,
    ]),
    ...(value.analysis_windows || []).map((w) => w.purpose),
  ]) {
    const assertions = s.replace(
      /(?:不(?:能|會|可|作)?|無法|未|沒有|並非|不能提供)\s*保證.{0,6}(?:獲利|賺|上漲)/g,
      "",
    );
    if (/保證.{0,6}(獲利|賺|上漲)|勝率\s*\d|獲利機率\s*\d/.test(assertions))
      throw Error("AI回覆含未驗證獲利承諾");
    // Financial prose commonly expresses a negative result as 「毛損失1400元」.
    // Normalize explicit loss wording, without changing stop prices or EPS signs.
    const amounts = s.replace(
      /((?:毛損失|毛虧損|虧損|損失)\s*)(\d[\d,]*(?:\.\d+)?)\s*元/g,
      "$1負$2元",
    );
    for (const m of amounts.matchAll(
      /(?:NT\$|新台幣|價格|價位|停損|停利|目標價|支撐|壓力)\s*[：:為在約]?\s*([-−﹣－＋+負]?[\d,]+(?:\.\d+)?)\s*(?:元)?|([-−﹣－＋+負]?[\d,]+(?:\.\d+)?)\s*元/g,
    ))
      if (
        !allowed.has(
          String(
            Number(
              (m[1] || m[2])
                .replaceAll(",", "")
                .replaceAll("−", "-")
                .replaceAll("﹣", "-")
                .replaceAll("－", "-")
                .replaceAll("負", "-")
                .replaceAll("＋", "+"),
            ),
          ),
        )
      )
        throw Object.assign(
          Error(`AI回覆含非平台計算價位或金額：${m[0]}；損益需先使用試算工具`),
          { validation_detail: { assertion: m[0] } },
        );
  }
  return value;
}
