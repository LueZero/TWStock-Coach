// Makes real subscription Codex calls and creates independent test Sessions.
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
process.loadEnvFile();
const base =
  (process.env.ASSISTANT_URL || "http://127.0.0.1:8010") + "/api/assistant";
let cookie;
async function request(path, body) {
  const response = await fetch(base + path, {
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json();
  assert.ok(response.ok, JSON.stringify(data));
  return { data, response };
}
const login = await request("/login", {
  access_key: process.env.ASSISTANT_ACCESS_KEY,
});
cookie = login.response.headers.get("set-cookie").split(";")[0];
const health = (await request("/status")).data;
assert.ok(health.ready, health.note);
assert.ok(!health.active_session, "請先完成目前對話");
const input = {
  mode: process.env.ASSISTANT_TEST_AS_OF ? "historical" : "latest",
  ...(process.env.ASSISTANT_TEST_AS_OF
    ? { as_of: process.env.ASSISTANT_TEST_AS_OF }
    : {}),
};
const create = async () => (await request("/sessions", input)).data;
const a = await create(),
  b = await create(),
  marker = "會話測試-" + randomUUID();
async function ask(id, message) {
  await request(`/sessions/${id}/messages`, { message });
  const deadline = Date.now() + 400000;
  let last = 0;
  while (Date.now() < deadline) {
    const session = (await request(`/sessions/${id}`)).data,
      turn = session.turns.at(-1);
    for (const event of turn.events)
      if (event.id > last) {
        if (event.type === "progress") console.log(event.message);
        last = event.id;
      }
    if (turn.status !== "running") {
      assert.equal(turn.status, "completed", turn.error);
      return session;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw Error("驗證等待逾時；後端狀態請在Chat查看");
}
let current = await ask(
  a.id,
  `請記住這段對話的代號是「${marker}」。只回覆已記住，不必查資料。`,
);
const thread = current.codex_session_id;
assert.ok(thread);
assert.equal(current.turns[0].tool_calls.length, 0);
const separate = await ask(
  b.id,
  "本段對話我有給研究代號嗎？若沒有只回覆沒有，不可猜測，不必查資料。",
);
assert.ok(!separate.turns[0].answer.includes(marker));
assert.notEqual(separate.codex_session_id, thread);
current = await ask(a.id, "剛才我給的研究代號是什麼？只回覆代號，不必查資料。");
assert.ok(current.turns.at(-1).answer.includes(marker));
assert.equal(current.codex_session_id, thread);
current = await ask(
  a.id,
  "請依名稱查詢台積電近期完成日K與MA5、MA20、MA60，載入相關研究技能、顯示K線並存一份簡短技術研究報告。暫時不用其他面向，說明實際資料日期與限制。",
);
const last = current.turns.at(-1);
assert.ok(last.artifacts.some((a) => a.type === "chart"));
assert.ok(last.artifacts.some((a) => a.type === "report"));
await mkdir(".tmp", { recursive: true });
await writeFile(
  ".tmp/assistant-chat-id.json",
  JSON.stringify({ session_id: a.id, separate_id: b.id, thread }),
);
console.log(
  JSON.stringify({
    status: "passed",
    session_id: a.id,
    sessionIsolation: true,
    resumed: current.codex_session_id === thread,
    artifacts: last.artifacts.map((a) => a.type),
  }),
);
