import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent } from "../server.js";
import { cliActivity } from "../progress.js";

test("CLI活動不轉送推理、命令、原始工具資料或提示詞", () => {
  assert.equal(
    cliActivity({
      type: "item.completed",
      item: { type: "reasoning", text: "private" },
    }),
    null,
  );
  const event = cliActivity({
    type: "item.started",
    item: {
      type: "mcp_tool_call",
      server: "stock",
      tool: "get_stock_data",
      arguments: { section: "technical", start: "2026-10-01" },
      result: { secret: "not sent" },
    },
  });
  assert.match(event.message, /技術指標/);
  assert.match(event.message, /2026-10-01/);
  assert.ok(!JSON.stringify(event).includes("secret"));
});

test("Chat SSE需解鎖、即時文字與活動、斷線不取消、重連續接及保存完成紀錄", async () => {
  const directory = await mkdtemp(join(tmpdir(), "twstock-chat-stream-"));
  let options, finish;
  const app = createAgent({
    sessionDirectory: directory,
    accessKey: "stream-test-key-1234567890123456",
    health: async () => ({ ready: true }),
    chatRun: async (_s, _t, callbacks) => {
      options = callbacks;
      return new Promise((resolve, reject) => {
        callbacks.signal.addEventListener(
          "abort",
          () => reject(Error("已取消")),
          { once: true },
        );
        finish = () =>
          resolve({
            answer: "本次資料已核對。",
            session_id: "test-thread",
            tool_calls: [],
          });
      });
    },
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${app.server.address().port}/api/assistant`;
  let reader;
  try {
    const login = await fetch(base + "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_key: "stream-test-key-1234567890123456" }),
    });
    const headers = {
      Cookie: login.headers.get("set-cookie").split(";")[0],
      "Content-Type": "application/json",
    };
    const created = await (
        await fetch(base + "/sessions", {
          method: "POST",
          headers,
          body: JSON.stringify({
            market: "TWSE",
            symbol: "2883",
            name: "測試",
          }),
        })
      ).json(),
      path = `/sessions/${created.id}`;
    await fetch(base + path + "/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({ message: "測試進度" }),
    });
    assert.equal((await fetch(base + path + "/events")).status, 401);
    assert.equal(
      (
        await fetch(base + path + "/events", {
          headers: { ...headers, Origin: "https://example.invalid" },
        })
      ).status,
      403,
    );
    const response = await fetch(base + path + "/events", {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    assert.equal(response.headers.get("x-accel-buffering"), "no");
    reader = response.body.getReader();
    await reader.read();
    options.onProgress({ phase: "querying", message: "正在核對技術指標" });
    options.onMessage({ id: "item_3", text: "先看量價。" });
    let text = "";
    while (!text.includes("assistant_text")) {
      text += new TextDecoder().decode((await reader.read()).value);
    }
    assert.ok(text.includes("先看量價"));
    options.onMessage({ id: "item_3", text: "先看量價，再看資料日期。" });
    options.onMessage({ id: "item_3", text: "先看量價，再看資料日期。" });
    const live = (await (await fetch(base + path, { headers })).json())
      .turns[0];
    assert.equal(live.drafts.length, 1);
    assert.equal(live.drafts[0].text, "先看量價，再看資料日期。");
    assert.equal(
      live.events.filter((e) => e.type === "assistant_text").length,
      2,
    );
    await reader.cancel();
    reader = null;
    assert.equal(
      (await (await fetch(base + path, { headers })).json()).turns[0].status,
      "running",
    );
    const replay = await fetch(base + path + "/events", {
      headers: { ...headers, "Last-Event-ID": "1" },
      signal: AbortSignal.timeout(10000),
    });
    reader = replay.body.getReader();
    text = "";
    while (!text.includes("assistant_text"))
      text += new TextDecoder().decode((await reader.read()).value);
    assert.ok(!text.includes("正在核對技術指標"));
    await reader.cancel();
    reader = null;
    finish();
    let doc;
    for (let i = 0; i < 50; i++) {
      doc = await (await fetch(base + path, { headers })).json();
      if (doc.turns[0].status !== "running") break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(doc.turns[0].status, "completed");
    const saved = JSON.parse(
      await readFile(join(directory, created.id, "session.json"), "utf8"),
    );
    assert.equal(saved.codex_session_id, "test-thread");
    assert.equal(saved.turns[0].answer, "本次資料已核對。");
  } finally {
    await reader?.cancel();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
