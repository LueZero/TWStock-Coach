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
    ...r.summary.map(markdownText),
    "",
    "## AI解讀",
    "",
    markdownText(r.ai?.answer ?? doc.run.error ?? "分析尚未完成"),
  ];
  if (r.ai)
    for (const h of r.ai.highlights)
      lines.push(
        "",
        `- ${markdownText(h.text)}（依據：${h.evidence_ids.join("、")}）`,
      );
  lines.push("", "## 進出場條件", "");
  for (const s of r.scenarios)
    lines.push(
      `### ${markdownText(s.label)}`,
      "",
      `觸發 ${s.trigger}／失效 ${s.stop}／參考目標 ${s.target}；${s.enabled ? "候選條件" : "停用"}；${s.confirmed ? "技術確認" : "未確認"}。`,
      "",
      `數量上限 ${s.max_shares} 股；估算風險 ${s.risk_at_stop}；成本後報酬風險比 ${s.net_reward_risk}；參考期限 ${s.valid_until}。`,
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
