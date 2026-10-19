import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cliActivity } from "./progress.js";
export async function runCodexProcess({
  binary,
  directory,
  contextPath,
  schema,
  output,
  sessionId,
  prompt,
  signal,
  onProgress = () => {},
  onMessage,
  onThread,
  env,
  mcpServer = "./mcp-server.js",
  timeoutMs = 360000,
}) {
  const args = [
    "exec",
    ...(sessionId ? ["resume"] : []),
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--json",
    "--disable",
    "shell_tool",
    "--disable",
    "unified_exec",
    "-c",
    'sandbox_mode="read-only"',
    "-c",
    'forced_login_method="chatgpt"',
    "-c",
    "agents.enabled=true",
    "-c",
    `mcp_servers.stock.command=${JSON.stringify(process.execPath)}`,
    "-c",
    `mcp_servers.stock.args=${JSON.stringify([fileURLToPath(new URL(mcpServer, import.meta.url)), contextPath])}`,
    "-c",
    "mcp_servers.stock.required=true",
    "-c",
    "mcp_servers.stock.tool_timeout_sec=60",
    "-c",
    'web_search="disabled"',
    ...(schema ? ["--output-schema", schema] : []),
    "--output-last-message",
    output,
    ...(sessionId ? [sessionId] : []),
    "-",
  ];
  if (process.env.ASSISTANT_MODEL)
    args.splice(1, 0, "--model", process.env.ASSISTANT_MODEL);
  let usage = null,
    threadId = sessionId || null,
    finalText = "";
  await new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: directory,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = "",
      size = 0,
      settled = false;
    const kill = () => {
      if (process.platform !== "win32") {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      } else child.kill();
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (error) {
        kill();
        reject(error);
      } else resolve();
    };
    const cancel = () => finish(Error("工作已取消"));
    const timer = setTimeout(() => finish(Error("Codex分析逾時")), timeoutMs);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) {
      cancel();
      return;
    }
    child.on("error", () => finish(Error("Codex無法啟動")));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > 6000000) {
        finish(Error("Codex輸出超過限制"));
        return;
      }
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const event = JSON.parse(line);
          const activity = cliActivity(event);
          if (activity) onProgress(activity);
          if (event.type === "thread.started") {
            threadId = event.thread_id;
            onThread?.(threadId);
          }
          if (
            ["command_execution", "web_search", "file_change"].includes(
              event.item?.type,
            )
          ) {
            finish(Error("看盤助手只允許平台資料工具"));
            return;
          }
          if (
            event.item?.type === "mcp_tool_call" &&
            event.item.server !== "stock"
          ) {
            finish(Error("未授權的MCP工具"));
            return;
          }
          if (event.type === "turn.completed") usage = event.usage;
          if (
            ["item.started", "item.updated", "item.completed"].includes(
              event.type,
            ) &&
            event.item?.type === "agent_message"
          ) {
            if (event.type === "item.completed") finalText = event.item.text;
            if (typeof event.item.text === "string" && event.item.text)
              onMessage?.({ id: event.item.id, text: event.item.text });
          }
        } catch {
          /* Non-JSON diagnostic lines are not exposed. */
        }
      }
    });
    child.stderr.on("data", () => {});
    child.on("close", (code) =>
      finish(code === 0 ? null : Error("Codex執行失敗")),
    );
    child.stdin.on("error", () => {});
    if (Buffer.byteLength(prompt) > 350000) {
      finish(Error("資料包超過模型輸入預算，請縮小分析範圍"));
      return;
    }
    child.stdin.end(prompt);
  });

  return { usage, threadId, finalText };
}
