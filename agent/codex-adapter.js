import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveCodexBinary } from "./codex-binary.js";
const execute = promisify(execFile);
export function codexEnvironment() {
  const allowed = [
    "PATH",
    "Path",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "TEMP",
    "TMP",
    "CODEX_HOME",
    "CODEX_CA_CERTIFICATE",
    "SSL_CERT_FILE",
  ];
  const env = Object.fromEntries(
    allowed
      .filter((k) => process.env[k] != null)
      .map((k) => [k, process.env[k]]),
  );
  return env;
}
export async function codexHealth(
  binary = process.env.CODEX_BIN || "codex",
  run = execute,
) {
  try {
    binary = resolveCodexBinary(binary);
    const version = (
      await run(binary, ["--version"], {
        timeout: 10000,
        windowsHide: true,
        env: codexEnvironment(),
      })
    ).stdout.trim();
    const login = await run(binary, ["login", "status"], {
      timeout: 10000,
      windowsHide: true,
      env: codexEnvironment(),
    });
    if (
      !/logged in using chatgpt\b/i.test(login.stdout + login.stderr) ||
      /not logged in/i.test(login.stdout + login.stderr)
    )
      return {
        ready: false,
        version,
        note: "助手只支援ChatGPT訂閱登入；請執行codex login並選擇Sign in with ChatGPT。",
      };
    return {
      ready: true,
      version,
      note: "Codex已使用ChatGPT訂閱登入，可透過平台資料工具進行研究對話。",
    };
  } catch {
    return {
      ready: false,
      version: "unavailable",
      note: "Codex未安裝或未登入；請確認CODEX_BIN與codex login。",
    };
  }
}
