import { mkdtemp, writeFile, readFile, rm, cp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCodexProcess } from "./codex-process.js";
import { codexEnvironment } from "./codex-adapter.js";
import { resolveCodexBinary } from "./codex-binary.js";
import { skillCatalogue } from "./research-skills.js";

export const CHAT_VERSION = "stock-chat-v2";
export function chatPrompt(session, turn, skills = []) {
  return `你是「股票助手」，遵守本次AGENTS.md。Session ${session.id}不綁定任何股票，依使用者本次描述搜尋並確認標的，可在同一對話換股、比較多檔、問大盤或概念；不使用平台選股當預設。舊脈絡標的只供理解代詞：${JSON.stringify(session.targets || (session.stock ? [session.stock] : []))}。\n模式：${session.mode}；歷史截止：${session.as_of || "無（各標的首次查詢固定自己的截止）"}。本輪市場事實須重新查詢，不能沿用舊行情。\n可用研究技能（僅目錄，需用read_research_skill載入實際內容）：${JSON.stringify(skills)}。查實際資料前先載入twstock-evidence，再按需要選技術、比較或持倉技能，不必全部載入。概念短問可直接回答。\n不要強制七章報告。需要時顯示K線或保存研究報告。\n本次訊息：${JSON.stringify(turn.message)}`;
}
export async function runChat(
  session,
  turn,
  {
    signal,
    onProgress = () => {},
    onMessage = () => {},
    onTool = () => {},
    onThread = () => {},
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "twstock-chat-"));
  const auditPath = join(directory, "tool-audit.jsonl");
  let timer,
    delivered = 0,
    draining = null;
  const drain = () =>
    (draining ||= (async () => {
      try {
        const lines = (await readFile(auditPath, "utf8")).split("\n");
        lines.pop(); // Do not parse a partially written last line.
        while (delivered < lines.length) {
          const call = JSON.parse(lines[delivered++]);
          onTool(call);
        }
      } finally {
        draining = null;
      }
    })());
  try {
    const contextPath = join(directory, "context.json"),
      output = join(directory, "answer.md");
    const asOf = session.as_of || new Date().toISOString();
    const end = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(asOf));
    const start = new Date(Date.parse(end + "T00:00:00Z") - 180 * 86400000)
      .toISOString()
      .slice(0, 10);
    await cp(
      new URL("./AGENTS.md", import.meta.url),
      join(directory, "AGENTS.md"),
    );
    await writeFile(auditPath, "", { mode: 0o600 });
    await writeFile(
      contextPath,
      JSON.stringify({
        api_url: process.env.ASSISTANT_STOCK_API_URL || "http://127.0.0.1:8000",
        audit_path: auditPath,
        known_targets:
          session.targets || (session.stock ? [session.stock] : []),
        user_message: session.turns
          .map((t) => t.message)
          .join("\n")
          .slice(-60000),
        scope: {
          mode: session.mode,
          as_of: asOf,
          start,
          end,
          range_mode: "auto",
        },
      }),
      { mode: 0o600 },
    );
    timer = setInterval(() => {
      drain().catch(() => {});
    }, 150);
    const result = await runCodexProcess({
      binary: resolveCodexBinary(process.env.CODEX_BIN || "codex"),
      directory,
      contextPath,
      output,
      sessionId: session.codex_session_id,
      prompt: chatPrompt(session, turn, await skillCatalogue()),
      signal,
      onProgress: (activity) =>
        onProgress({
          ...activity,
          ...(activity.phase === "validating"
            ? { message: "正在保存回答與研究內容" }
            : activity.phase === "writing"
              ? { message: "AI 正在整理回覆" }
              : {}),
        }),
      onMessage,
      onThread,
      env: codexEnvironment(),
      mcpServer: "./chat-mcp-server.js",
      timeoutMs: 360000,
    });
    const answer = (
      await readFile(output, "utf8").catch(() => result.finalText)
    )?.trim();
    if (!answer || answer.length > 60000) throw Error("Codex未傳回有效回答");
    const calls = (await readFile(auditPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    await drain();
    return {
      answer,
      session_id: result.threadId,
      usage: result.usage,
      tool_calls: calls,
      scope: {
        mode: session.mode,
        as_of: asOf,
        start,
        end,
        targets: calls
          .filter((c) => c.target && c.evidence_id)
          .map((c) => ({
            market: c.market,
            symbol: c.symbol,
            as_of: c.as_of || c.scope?.as_of,
          })),
      },
    };
  } catch (error) {
    try {
      error.tool_calls = (await readFile(auditPath, "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch {}
    throw error;
  } finally {
    clearInterval(timer);
    if (draining) await draining.catch(() => {});
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 200,
    }).catch(() => {});
  }
}
