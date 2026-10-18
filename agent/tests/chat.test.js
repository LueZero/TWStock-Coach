import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createAgent } from "../server.js";
import { createChatTools } from "../chat-tools.js";
import { calculateTrade } from "../trade-math.js";
import { stockPriceValues } from "../price-evidence.js";

test("Session獨立、同股票可新增、指定原生thread接續，停止與失敗不污染其他對話", async () => {
  const directory = await mkdtemp(join(tmpdir(), "twstock-chat-test-"));
  const jobs = [];
  let finish, options;
  const app = createAgent({
    sessionDirectory: directory,
    accessKey: "chat-test-key-1234567890123456",
    health: async () => ({ ready: true }),
    chatRun: async (session, turn, callbacks) => {
      jobs.push({
        id: session.id,
        thread: session.codex_session_id,
        message: turn.message,
      });
      options = callbacks;
      if (turn.message === "取消")
        return new Promise((resolve, reject) =>
          callbacks.signal.addEventListener(
            "abort",
            () => reject(Error("已停止")),
            { once: true },
          ),
        );
      return new Promise((resolve) => {
        finish = () =>
          resolve({
            answer: "已核對資料。",
            session_id: "thread-" + session.id,
            tool_calls: [],
            scope: { as_of: "2026-10-17T00:00:00Z" },
          });
      });
    },
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${app.server.address().port}/api/assistant`;
  try {
    assert.equal((await fetch(base + "/sessions")).status, 401);
    const login = await fetch(base + "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_key: "chat-test-key-1234567890123456" }),
    });
    const headers = {
      "Content-Type": "application/json",
      Cookie: login.headers.get("set-cookie").split(";")[0],
    };
    const request = async (path, body) =>
      fetch(base + path, {
        headers,
        ...(body === undefined
          ? {}
          : { method: "POST", body: JSON.stringify(body) }),
      });
    const a = await (
      await request("/sessions", {
        market: "TWSE",
        symbol: "00927",
        name: "ETF",
      })
    ).json();
    const b = await (
      await request("/sessions", {
        market: "TWSE",
        symbol: "00927",
        name: "ETF",
      })
    ).json();
    assert.notEqual(a.id, b.id);
    assert.equal(
      (await request(`/sessions/${a.id}/messages`, { message: "第一問" }))
        .status,
      202,
    );
    options.onThread("thread-" + a.id);
    assert.equal(
      (await request(`/sessions/${b.id}/messages`, { message: "不應寫入" }))
        .status,
      409,
    );
    assert.equal(
      (await (await request(`/sessions/${b.id}`)).json()).turns.length,
      0,
    );
    const artifact = {
      id: randomUUID(),
      type: "report",
      title: "研究",
      markdown: "已核對",
      evidence_ids: ["tool:a"],
    };
    options.onProgress({ phase: "querying", message: "查行情" });
    options.onMessage({ id: "item_1", text: "正在核對完成日K。" });
    options.onTool({
      name: "save_research_report",
      arguments: {},
      status: "completed",
      artifact,
    });
    const streaming = await (await request(`/sessions/${a.id}`)).json();
    assert.equal(streaming.turns[0].artifacts[0].id, artifact.id);
    assert.equal(streaming.codex_session_id, "thread-" + a.id);
    const ids = streaming.turns[0].events.map((e) => e.id);
    assert.ok(ids.every(Number.isInteger));
    assert.equal(new Set(ids).size, ids.length);
    finish();
    let doc;
    for (let i = 0; i < 50; i++) {
      doc = await (await request(`/sessions/${a.id}`)).json();
      if (doc.turns[0].status !== "running") break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(doc.turns[0].status, "completed");
    assert.equal(doc.codex_session_id, "thread-" + a.id);
    assert.equal(
      (await request(`/sessions/${a.id}/messages`, { message: "取消" })).status,
      202,
    );
    assert.equal(jobs.at(-1).thread, "thread-" + a.id);
    await request(`/sessions/${a.id}/cancel`, {});
    for (let i = 0; i < 50; i++) {
      doc = await (await request(`/sessions/${a.id}`)).json();
      if (doc.turns.at(-1).status !== "running") break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(doc.turns.at(-1).status, "cancelled");
    assert.equal(doc.turns[0].answer, "已核對資料。");
    assert.equal((await request("/reports", {})).status, 410);
    assert.equal(
      (await request(`/sessions/${b.id}/messages`, { message: "另一段" }))
        .status,
      202,
    );
    assert.equal(jobs.at(-1).thread, null);
    finish();
    const crossing = await fetch(base + `/sessions/${a.id}/messages`, {
      method: "POST",
      headers: { ...headers, Origin: "https://example.invalid" },
      body: JSON.stringify({ message: "跨站" }),
    });
    assert.equal(crossing.status, 403);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Chat工具按需查資料，報告不能用舊證據、編造金額，圖表只能聚焦真實K棒", async () => {
  let requests = 0;
  const calls = [];
  const context = {
    api_url: "http://127.0.0.1:8000",
    user_message: "",
    scope: {
      market: "TWSE",
      symbol: "2883",
      mode: "historical",
      as_of: "2026-10-17T00:00:00Z",
      start: "2026-10-01",
      end: "2026-10-16",
      range_mode: "auto",
    },
    snapshot: {
      report: {
        meta: { asset: "stock" },
        evidence: [
          {
            id: "quote:snapshot",
            category: "technical",
            rows: [
              {
                last_price: 38.5,
                bids: [{ price: 38.45, volume_shares: 1000 }],
              },
            ],
            source_time: "2026-10-16T05:30:00Z",
            received_at: "2026-10-16T05:30:01Z",
          },
        ],
        metrics: {},
        scenarios: [],
        observations: [],
        chart_annotations: [],
      },
      input: {
        bars: [
          {
            trade_date: "2026-10-16",
            open: 38,
            high: 39,
            low: 37,
            close: 38.5,
            volume: 1000,
            is_final: true,
          },
        ],
        quality: [],
        facets: [],
      },
    },
  };
  const tools = createChatTools(context, {
    fetcher: () => {
      requests++;
      throw Error("不應查網路");
    },
    onCall: (c) => calls.push(c),
  });
  assert.equal(requests, 0);
  const quote = await tools.call("get_stock_quote", {});
  assert.equal(quote.data.quote.bids[0].volume_shares, 1000);
  assert.equal(quote.data.source_time, "2026-10-16T05:30:00Z");
  await assert.rejects(
    tools.call("save_research_report", {
      title: "假的",
      markdown: "觀察",
      evidence_ids: ["old:evidence"],
    }),
    /本輪/,
  );
  const chart = await tools.call("show_stock_chart", {});
  assert.ok(chart.artifact_id);
  assert.equal(calls.find((c) => c.artifact)?.artifact.bars[0].close, 38.5);
  await assert.rejects(
    tools.call("show_stock_chart", { focus_date: "2026-10-15" }),
    /焦點日期/,
  );
  const source = calls.find((c) => c.evidence_id).evidence_id;
  await assert.rejects(
    tools.call("save_research_report", {
      title: "假的",
      markdown: "買入價999元。",
      evidence_ids: [source],
    }),
    /非平台/,
  );
  const saved = await tools.call("save_research_report", {
    title: "觀察",
    markdown: "日K收盤38.50元，仍須確認量價。",
    evidence_ids: [source],
  });
  assert.ok(saved.displayed);
  assert.equal(requests, 0);
});

test("使用者明示成本可試算且不升格為平台委託價，獲利願望不能當成本", () => {
  const snapshot = {
    report: { asset: "etf", evidence: [], chart_bars: [{ close: 38.22 }] },
    input: { bars: [] },
  };
  const result = calculateTrade(
    {
      buy_price: 40.61,
      sell_price: 38.22,
      shares: 1000,
      buy_price_source: "user_cost",
    },
    snapshot,
    "持有40.61一張",
  );
  assert.equal(result.gross_profit, -2390);
  const prices = stockPriceValues(
    { asset: "etf", evidence: [{ data: result }] },
    [],
    { executable: true },
  );
  assert.ok(!prices.has("40.61"));
  assert.ok(prices.has("38.22"));
  assert.throws(
    () =>
      calculateTrade(
        {
          buy_price: 2000,
          sell_price: 38.22,
          shares: 1000,
          buy_price_source: "user_cost",
        },
        snapshot,
        "希望賺2000元，一張",
      ),
    /不能自行編造/,
  );
  assert.throws(
    () =>
      calculateTrade(
        {
          buy_price: 2000,
          sell_price: 38.22,
          shares: 1000,
          buy_price_source: "user_cost",
        },
        snapshot,
        "持有40.61一張，希望賺2000元",
      ),
    /不能自行編造/,
  );
});
