import { mkdir, writeFile, readFile, readdir, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";

export function validateId(id) {
  if (
    typeof id !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      id,
    )
  )
    throw Object.assign(Error("報告ID不符"), { statusCode: 422 });
  return id;
}
const markdownText = (text) =>
  String(text ?? "")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
export function reportMarkdown(doc) {
  const r = doc.report;
  const lines = [
    `# ${markdownText(r.meta.name)} ${r.meta.symbol} 個股分析報告`,
    "",
    `- 報告ID：${r.id}`,
    `- 分析截止：${r.meta.as_of}`,
    `- 行情日期：${r.meta.data_date ?? "不足"}`,
    `- 狀態：${doc.run.status}`,
    `- 規則：${r.version}`,
    "",
    "## 重點摘要",
    "",
    markdownText(
      r.ai?.summary ||
        (r.ai
          ? "此舊版報告未單獨生成AI摘要，請閱讀下方AI解讀。"
          : "AI摘要尚未完成。"),
    ),
    "",
    "## AI解讀",
    "",
    markdownText(r.ai?.answer ?? doc.run.error ?? "分析尚未完成"),
  ];
  if (r.ai?.analysis_windows?.length)
    lines.push(
      "",
      "## 實際分析期間",
      "",
      ...r.ai.analysis_windows.map(
        (w) => `- ${w.start} ～ ${w.end}：${markdownText(w.purpose)}`,
      ),
    );
  if (r.ai?.action_plan?.length) {
    lines.push("", "## 你可以怎麼做", "");
    const labels = {
      entry: "還沒買：先等什麼",
      holding: "已持有：如何觀察",
      exit: "想退出：何時重評估",
    };
    for (const a of r.ai.action_plan)
      lines.push(
        `### ${labels[a.id]}`,
        "",
        `**先看條件**：${markdownText(a.condition)}`,
        "",
        `**下一步**：${markdownText(a.action)}`,
        "",
        `**看法失效時**：${markdownText(a.invalidation)}`,
        "",
        `依據：${a.evidence_ids.join("、")}`,
        "",
      );
  }
  if (r.ai?.sections?.length) {
    lines.push("", "## 為什麼這樣判斷", "");
    for (const s of r.ai.sections)
      lines.push(
        `### ${markdownText(s.title)}`,
        "",
        markdownText(s.takeaway),
        "",
        `**資料怎麼說**：${markdownText(s.reason)}`,
        "",
        `**接下來看什麼**：${markdownText(s.watch)}`,
        "",
        `依據：${s.evidence_ids.join("、")}`,
        "",
      );
    if (r.ai.cautions?.length)
      lines.push(
        "## 這次判斷有哪些限制",
        "",
        ...r.ai.cautions.map((c) => `- ${markdownText(c)}`),
        "",
      );
  }
  if (r.ai)
    lines.push(
      "",
      `本次工具查詢截止：${r.ai.analysis_scope?.as_of || r.meta.as_of}；查詢證據 ${r.ai.tool_evidence_ids?.length || 0} 筆。`,
    );
  const inputManifest = r.ai?.input_manifest || r.input_manifest;
  if (inputManifest?.length)
    lines.push(
      "",
      "## 提交給AI的資料",
      "",
      ...inputManifest.map(
        (m) =>
          `- ${m.label}：${m.status}；${m.evidence_count ?? 0} 項來源證據${m.bar_count == null ? "" : `；${m.bar_count} 根完成日K`}${m.note ? `；${markdownText(m.note)}` : ""}`,
      ),
    );
  if (doc.tool_calls?.length)
    lines.push(
      "",
      "## 工具查詢紀錄",
      "",
      ...doc.tool_calls.map(
        (c) =>
          `- ${c.name} ${JSON.stringify(c.arguments)}：${c.status}；截止 ${c.as_of}；查詢 ${c.queried_at}；${c.evidence_id || markdownText(c.error)}`,
      ),
    );
  if (r.ai)
    for (const h of r.ai.highlights)
      lines.push(
        "",
        `- ${markdownText(h.text)}（依據：${h.evidence_ids.join("、")}）`,
      );
  if (r.observations?.length)
    lines.push(
      "",
      "## 技術判讀",
      "",
      ...r.observations.flatMap((o) => [
        `### ${markdownText(o.label)}`,
        "",
        markdownText(o.note),
        "",
        `依據：${o.evidence_ids.join("、") || "暖機不足"}`,
        "",
      ]),
    );
  if (r.meta.industry)
    lines.push("", "## 公司產業", "", markdownText(r.meta.industry));
  lines.push("", "## 進出場條件", "");
  if (r.plan_checks?.length)
    lines.push(
      ...r.plan_checks.map(
        (c) =>
          `- ${c.passed ? "符合" : "待符合"}：${markdownText(c.label)}；${markdownText(c.detail)}`,
      ),
      "",
    );
  if (r.chart_annotations?.length)
    lines.push(
      "### K線技術事件",
      "",
      ...r.chart_annotations.map(
        (m) => `- ${m.date} ${markdownText(m.label)}：${markdownText(m.note)}`,
      ),
      "",
    );
  for (const s of r.scenarios)
    lines.push(
      `### ${markdownText(s.label)}`,
      "",
      `觸發 ${s.trigger}／失效 ${s.stop}／參考目標 ${s.target}；${s.enabled ? "候選條件" : "停用"}；${s.confirmed ? "技術確認" : "未確認"}。`,
      "",
      ...(s.max_shares != null
        ? [
            `數量上限 ${s.max_shares} 股；估算風險 ${s.risk_at_stop}；成本後報酬風險比 ${s.net_reward_risk}。`,
          ]
        : []),
      `參考期限 ${s.valid_until}。`,
      "",
      ...s.conditions.map(markdownText),
      "",
      markdownText(s.invalidation),
      "",
      markdownText(s.note),
      "",
    );
  if (!r.scenarios.length) lines.push("資料或條件不足，沒有正式價位計畫。");
  if (r.holding)
    lines.push(
      "",
      "## 持倉",
      "",
      `成本 ${r.holding.cost} 元／${r.holding.shares} 股／未實現毛損益 ${r.holding.unrealized_gross} 元。`,
      "",
      markdownText(r.holding.exit_condition),
      "",
      markdownText(r.holding.note),
    );
  lines.push(
    "",
    "## 資料品質與限制",
    "",
    ...r.quality.map((q) => `- ${markdownText(q.label)}`),
    ...r.limitations.map((t) => `- ${markdownText(t)}`),
    ...(r.ai?.cautions ?? []).map((t) => `- ${markdownText(t)}`),
  );
  lines.push(
    "",
    "## 來源索引",
    "",
    ...r.evidence.map(
      (e) =>
        `- ${e.id}：${markdownText(e.label)}；${e.date ?? e.as_of ?? "日期見JSON"}${e.value == null ? "" : `；${e.value} ${e.unit ?? ""}`}`,
    ),
  );
  const followups = doc.messages.slice(1);
  if (followups.length)
    lines.push(
      "",
      "## 對話紀錄",
      "",
      ...followups.flatMap((m) => [
        `### ${m.role === "user" ? "你" : "看盤助手"}`,
        "",
        markdownText(m.content.answer ?? m.content.text),
        "",
      ]),
    );
  lines.push(
    "",
    "完整輸入、来源修訂、K線標記、費用設定、CLI session與Token用量保存在同目錄 report.json。",
    "",
  );
  return lines.join("\n");
}
export function createReportStore(directory) {
  const root = resolve(directory);
  const file = (id, name) => join(root, validateId(id), name);
  async function save(doc) {
    const id = validateId(doc.report.id);
    await mkdir(join(root, id), { recursive: true });
    // JSON is canonical; replace each artifact atomically. No report is overwritten by a new analysis.
    for (const [name, content] of [
      ["report.md", reportMarkdown(doc)],
      ["report.json", JSON.stringify(doc, null, 2) + "\n"],
    ]) {
      const temporary = file(id, name + "." + randomUUID() + ".tmp");
      await writeFile(temporary, content, { mode: 0o600 });
      for (let attempt = 0; ; attempt++)
        try {
          await rename(temporary, file(id, name));
          break;
        } catch (e) {
          if (!["EPERM", "EBUSY", "EACCES"].includes(e.code) || attempt >= 10)
            throw e;
          await new Promise((r) => setTimeout(r, 20));
        }
    }
  }
  async function load(id) {
    try {
      return JSON.parse(await readFile(file(id, "report.json"), "utf8"));
    } catch (e) {
      if (e.code === "ENOENT")
        throw Object.assign(Error("找不到報告"), { statusCode: 404 });
      throw e;
    }
  }
  async function list(market, symbol) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (e) {
      if (e.code === "ENOENT") return [];
      throw e;
    }
    const reports = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/i.test(entry.name))
        continue;
      const doc = await load(entry.name);
      const r = doc.report;
      if (
        (!market || r.meta.market === market) &&
        (!symbol || r.meta.symbol === symbol)
      )
        reports.push({
          id: r.id,
          created_at: r.meta.created_at,
          meta: r.meta,
          status_label: r.status_label,
        });
    }
    return reports
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 100);
  }
  return {
    root,
    save,
    load,
    list,
    markdown: async (id) => reportMarkdown(await load(id)),
  };
}
