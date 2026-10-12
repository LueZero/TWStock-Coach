import { existsSync, readdirSync, statSync } from "node:fs";
import { join, isAbsolute } from "node:path";

export function resolveCodexBinary(binary = process.env.CODEX_BIN || "codex") {
  if (process.platform !== "win32" || isAbsolute(binary)) return binary;
  if (!["codex", "codex.exe"].includes(binary)) return binary;
  for (const dir of (process.env.Path || process.env.PATH || "").split(";")) {
    const candidate = join(dir, "codex.exe");
    if (existsSync(candidate)) return candidate;
  }
  // VS Code updates replace the extension directory, and existing terminals can
  // retain the old PATH. Locate the installed native CLI rather than a shell shim.
  const root = join(process.env.USERPROFILE || "", ".vscode", "extensions");
  try {
    const candidates = readdirSync(root)
      .filter((n) => n.startsWith("openai.chatgpt-"))
      .map((n) => join(root, n, "bin", "windows-x86_64", "codex.exe"))
      .filter(existsSync)
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (candidates.length) return candidates[0];
  } catch {}
  return binary;
}
