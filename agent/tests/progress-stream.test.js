import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { createAgent } from "../server.js";
import { cliActivity } from "../progress.js";

test("CLI活動不轉送推理、命令、原始工具資料或提示詞", () => {
  assert.equal(
    cliActivity({
      type: "item.completed",
      item: { type: "reasoning", text: "private reasoning" },
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
test("SSE需解鎖、即時推送、斷線不取消、重連可續接並保存完成紀錄", async () => {
  const directory = await mkdtemp(join(tmpdir(), "twstock-stream-test-"));
  let options, finish;
  const app = createAgent({
    directory,
    accessKey: "stream-test-key-1234567890123456",
    health: async () => ({ ready: true, version: "test" }),
    run: async (_job, callbacks) => {
      options = callbacks;
      return new Promise((resolve, reject) => {
        callbacks.signal.addEventListener(
          "abort",
          () => reject(Error("工作已取消")),
          { once: true },
        );
        if (_job.message === "失敗測試") {
          reject(Error("資料來源失敗測試"));
          return;
        }
        finish = () =>
          resolve({
            result: {
              summary: "等待量價確認。",
              answer: "本次資料已核對。",
              highlights: [],
              scenario_ids: [],
              cautions: [],
            },
            tool_calls: [],
            session_id: "test",
          });
      });
    },
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = app.server.address();
  const url = `http://127.0.0.1:${base.port}/api/assistant`;
  let reader;
  try {
    const login = await fetch(url + "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_key: "stream-test-key-1234567890123456" }),
    });
    const headers = {
      Cookie: login.headers.get("set-cookie").split(";")[0],
      "Content-Type": "application/json",
    };
    const stamp = new Date().toISOString();
    const report = {
      meta: {
        market: "TWSE",
        symbol: "2883",
        name: "測試",
        as_of: stamp,
        created_at: stamp,
      },
      evidence: [],
      scenarios: [],
      chart_bars: [],
      quality: [],
      limitations: [],
    };
    const response = await fetch(url + "/reports", {
      method: "POST",
      headers,
      body: JSON.stringify({
        report,
        input: {
          market: "TWSE",
          symbol: "2883",
          as_of: stamp,
          message: "測試進度",
        },
      }),
    });
    assert.equal(response.status, 202);
    const id = (await response.json()).report.id;
    assert.equal((await fetch(url + `/reports/${id}/events`)).status, 401);
    assert.equal(
      (
        await fetch(url + `/reports/${id}/events`, {
          headers: { ...headers, Origin: "https://untrusted.example" },
        })
      ).status,
      403,
    );
    const stream = await fetch(url + `/reports/${id}/events`, { headers });
    assert.match(stream.headers.get("content-type"), /text\/event-stream/);
    assert.equal(stream.headers.get("x-accel-buffering"), "no");
    reader = stream.body.getReader();
    const decoder = new TextDecoder();
    const first = decoder.decode((await reader.read()).value);
    assert.match(first, /分析已開始/);
    options.onProgress({ phase: "querying", message: "AI正在補查：技術指標" });
    const live = decoder.decode((await reader.read()).value);
    assert.match(live, /AI正在補查/);
    await reader.cancel();
    assert.equal(options.signal.aborted, false);
    const reconnect = await fetch(url + `/reports/${id}/events`, {
      headers: { ...headers, "Last-Event-ID": "1" },
    });
    reader = reconnect.body.getReader();
    const replay = decoder.decode((await reader.read()).value);
    assert.ok(!replay.includes("id: 1\n"));
    assert.match(replay, /補查/);
    finish();
    let tail = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      tail += decoder.decode(chunk.value);
    }
    assert.match(tail, /event: done/);
    assert.match(tail, /completed/);
    const doc = await (await fetch(url + `/reports/${id}`, { headers })).json();
    assert.equal(doc.run.status, "completed");
    assert.ok(doc.run.started_at);
    assert.ok(doc.progress_events.some((e) => e.phase === "querying"));
    const make = async (message) =>
      (
        await (
          await fetch(url + "/reports", {
            method: "POST",
            headers,
            body: JSON.stringify({
              report,
              input: { market: "TWSE", symbol: "2883", as_of: stamp, message },
            }),
          })
        ).json()
      ).report.id;
    const cancelled = await make("取消測試");
    const cancellation = await fetch(url + `/reports/${cancelled}/events`, {
      headers,
    });
    reader = cancellation.body.getReader();
    await reader.read();
    await fetch(url + `/reports/${cancelled}/cancel`, {
      method: "POST",
      headers,
      body: "{}",
    });
    let cancelledTail = "";
    for (;;) {
      const c = await reader.read();
      if (c.done) break;
      cancelledTail += decoder.decode(c.value);
    }
    assert.match(cancelledTail, /cancelled/);
    const failed = await make("失敗測試");
    const failure = await (
      await fetch(url + `/reports/${failed}/events`, { headers })
    ).text();
    assert.match(failure, /failed/);
    assert.match(failure, /資料來源失敗測試/);
  } finally {
    await reader?.cancel().catch(() => {});
    await app.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("twstock-stream-test-"));
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});
