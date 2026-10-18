import { mkdir, readFile, writeFile, readdir, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { validateId } from "./report-store.js";

export function createSessionStore(directory) {
  const root = resolve(directory);
  const file = (id) => join(root, validateId(id), "session.json");
  const writes = new Map();
  function save(session) {
    const id = validateId(session.id),
      content = JSON.stringify(session) + "\n";
    const next = (writes.get(id) || Promise.resolve())
      .catch(() => {})
      .then(() => write(id, content));
    writes.set(id, next);
    const cleanup = () => {
      if (writes.get(id) === next) writes.delete(id);
    };
    next.then(cleanup, cleanup);
    return next;
  }
  async function write(id, content) {
    const target = file(id);
    await mkdir(join(root, id), { recursive: true });
    const temporary = target + "." + randomUUID() + ".tmp";
    await writeFile(temporary, content, { mode: 0o600 });
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(temporary, target);
        break;
      } catch (error) {
        if (!["EPERM", "EBUSY", "EACCES"].includes(error.code) || attempt >= 10)
          throw error;
        await new Promise((r) => setTimeout(r, 20));
      }
    }
  }
  async function load(id) {
    try {
      return JSON.parse(await readFile(file(id), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT")
        throw Object.assign(Error("找不到對話"), { statusCode: 404 });
      throw error;
    }
  }
  async function list() {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const result = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/i.test(entry.name))
        continue;
      const session = await load(entry.name);
      result.push({
        id: session.id,
        title: session.title,
        stock: session.stock,
        targets: session.targets || (session.stock ? [session.stock] : []),
        mode: session.mode,
        as_of: session.as_of,
        updated_at: session.updated_at,
        turn_count: session.turns.length,
        status: session.turns.at(-1)?.status || "idle",
      });
    }
    return result.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  return { save, load, list };
}

export function sessionMarkdown(session) {
  return [
    `# ${session.title}`,
    "",
    `研究標的：${(session.targets || (session.stock ? [session.stock] : [])).map((s) => `${s.name} ${s.symbol}`).join("、") || "依對話辨識，不綁定股票"}`,
    `模式：${session.mode === "historical" ? "歷史截止 " + session.as_of : "每次提問更新資料截止"}`,
    ...session.turns.flatMap((turn) => [
      "",
      "## 你",
      "",
      turn.message,
      "",
      "## 股票助手",
      "",
      turn.answer || turn.error || "尚未完成",
      "",
      `本次資料截止：${turn.scope?.as_of || turn.started_at}`,
      ...turn.artifacts
        .filter((a) => a.type === "report")
        .flatMap((a) => ["", "### " + a.title, "", a.markdown]),
    ]),
    "",
  ].join("\n");
}
