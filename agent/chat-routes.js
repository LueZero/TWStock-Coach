import { randomUUID } from "node:crypto";
import { createSessionStore, sessionMarkdown } from "./session-store.js";
import { validateId } from "./report-store.js";
import { runChat, CHAT_VERSION } from "./chat-adapter.js";

export function registerChatRoutes(
  app,
  {
    authorized,
    health,
    directory = process.env.ASSISTANT_SESSION_DIR || "sessions",
    run = runChat,
    otherBusy = () => false,
  },
) {
  const store = createSessionStore(directory),
    subscribers = new Map();
  let active = null,
    task = null;
  const reject = (text, code = 422) => {
    throw Object.assign(Error(text), { statusCode: code });
  };
  function publish(session, turn, type, payload) {
    const event = {
      ...payload,
      id: (session.next_event_id = (session.next_event_id || 0) + 1),
      at: new Date().toISOString(),
      type,
    };
    turn.events.push(event);
    if (turn.events.length > 300) turn.events.shift();
    for (const send of subscribers.get(session.id) || []) send(type, event);
  }
  async function load(id) {
    validateId(id);
    if (active?.session.id === id) {
      const value = active.session;
      if (value.turns.at(-1)?.status !== "running") await task;
      return value;
    }
    const session = await store.load(id);
    const last = session.turns.at(-1);
    if (last?.status === "running") {
      last.status = "interrupted";
      last.error = "助手已中斷；原對話保留，可再次提問。";
      await store.save(session);
    }
    return session;
  }
  async function execute(session, turn, controller) {
    try {
      const response = await run(session, turn, {
        signal: controller.signal,
        onThread: (id) => {
          session.codex_session_id = id;
          store
            .save(session)
            .catch((error) =>
              console.error("Chat thread保存失敗", error.code || "unknown"),
            );
        },
        onProgress: (activity) => publish(session, turn, "progress", activity),
        onMessage: (message) => {
          if (!message.text || message.text.length > 60000) return;
          const draft = { id: message.id || randomUUID(), text: message.text };
          const existing = turn.drafts.find((d) => d.id === draft.id);
          if (existing?.text === draft.text) return;
          if (existing) existing.text = draft.text;
          else turn.drafts.push(draft);
          if (turn.drafts.length > 20) turn.drafts.shift();
          publish(session, turn, "assistant_text", {
            message_id: draft.id,
            text: draft.text,
          });
        },
        onTool: (call) => {
          turn.tool_calls.push(call);
          if (call.target) {
            session.targets ||= session.stock ? [session.stock] : [];
            if (
              !session.targets.some(
                (t) =>
                  t.market === call.target.market &&
                  t.symbol === call.target.symbol,
              )
            )
              session.targets.push(call.target);
          }
          if (call.artifact) {
            turn.artifacts.push(call.artifact);
            publish(session, turn, "artifact", { artifact: call.artifact });
            store
              .save(session)
              .catch((error) =>
                console.error("Chat研究內容保存失敗", error.code || "unknown"),
              );
          }
        },
      });
      if (controller.signal.aborted) throw Error("已停止回覆");
      turn.answer = response.answer;
      turn.tool_calls = response.tool_calls || turn.tool_calls;
      turn.artifacts = turn.tool_calls
        .filter((c) => c.artifact)
        .map((c) => c.artifact);
      turn.scope = response.scope;
      turn.usage = response.usage;
      turn.skills = turn.tool_calls
        .filter(
          (c) => c.name === "read_research_skill" && c.status === "completed",
        )
        .map((c) => ({ name: c.data.name, version: c.data.version }));
      session.codex_session_id =
        response.session_id || session.codex_session_id;
      turn.status = "completed";
    } catch (error) {
      turn.status = controller.signal.aborted ? "cancelled" : "failed";
      turn.error = error.message;
      if (error.tool_calls) {
        turn.tool_calls = error.tool_calls;
        turn.artifacts = error.tool_calls
          .filter((c) => c.artifact)
          .map((c) => c.artifact);
      }
    }
    turn.finished_at = new Date().toISOString();
    session.updated_at = turn.finished_at;
    try {
      // Persist the terminal event too, so reload and SSE replay see the same result.
      publish(session, turn, "progress", {
        phase: turn.status,
        message:
          turn.status === "completed" ? "回答與研究內容已完成" : turn.error,
      });
      await store.save(session);
    } catch (error) {
      turn.status = "failed";
      turn.error = "對話保存失敗，請檢查sessions目錄權限與空間。";
      console.error("Chat保存失敗", error.code || "unknown");
    } finally {
      for (const send of subscribers.get(session.id) || [])
        send("done", { status: turn.status });
      if (active?.session.id === session.id) active = null;
    }
  }
  app.get("/api/assistant/sessions", async (request) => {
    authorized(request);
    const list = await store.list();
    return list.map((s) => ({
      ...s,
      status:
        active?.session.id === s.id
          ? "running"
          : s.status === "running"
            ? "interrupted"
            : s.status,
    }));
  });
  app.post(
    "/api/assistant/sessions",
    { bodyLimit: 4096 },
    async (request, reply) => {
      authorized(request);
      const { mode = "latest", as_of } = request.body || {};
      if (!["latest", "historical"].includes(mode))
        reject("請選取有效研究模式");
      if (
        mode === "historical" &&
        (!Number.isFinite(Date.parse(as_of)) || Date.parse(as_of) > Date.now())
      )
        reject("歷史截止需為有效且不晚於現在的時間");
      const now = new Date().toISOString();
      const session = {
        id: randomUUID(),
        title: "新的股票研究",
        targets: [],
        mode,
        as_of: mode === "historical" ? new Date(as_of).toISOString() : null,
        created_at: now,
        updated_at: now,
        codex_session_id: null,
        version: CHAT_VERSION,
        turns: [],
        next_event_id: 0,
      };
      await store.save(session);
      return reply.code(201).send(session);
    },
  );
  app.get("/api/assistant/sessions/:id", async (request) => {
    authorized(request);
    return load(request.params.id);
  });
  app.patch(
    "/api/assistant/sessions/:id",
    { bodyLimit: 4096 },
    async (request) => {
      authorized(request);
      const session = await load(request.params.id);
      if (active?.session.id === session.id)
        reject("請等目前回答完成後再重新命名", 409);
      const title = request.body?.title;
      if (typeof title !== "string" || !title.trim() || title.length > 80)
        reject("對話名稱需為1至80字");
      session.title = title.trim();
      session.updated_at = new Date().toISOString();
      await store.save(session);
      return session;
    },
  );
  app.post(
    "/api/assistant/sessions/:id/messages",
    { bodyLimit: 40000 },
    async (request, reply) => {
      authorized(request);
      const message = request.body?.message;
      if (
        typeof message !== "string" ||
        !message.trim() ||
        message.length > 8000
      )
        reject("訊息需為1至8000字");
      if (active && active.session.turns.at(-1)?.status !== "running")
        await task;
      if (active || otherBusy())
        reject("另一段對話仍在回覆中，請等待完成或停止後再送出。", 409);
      const session = await load(request.params.id),
        service = await health();
      if (active || otherBusy()) reject("另一段對話仍在回覆中。", 409);
      if (!service.ready) reject(service.note || "請先登入Codex訂閱帳號", 503);
      const turn = {
        id: randomUUID(),
        agent_version: CHAT_VERSION,
        message: message.trim(),
        answer: null,
        status: "running",
        started_at: new Date().toISOString(),
        events: [],
        drafts: [],
        artifacts: [],
        tool_calls: [],
        error: null,
      };
      const controller = new AbortController();
      if (
        !session.turns.length &&
        (session.title === "新的股票研究" ||
          (session.stock &&
            session.title ===
              `${session.stock.name} ${session.stock.symbol} 的研究`))
      )
        session.title = message.trim().slice(0, 32);
      active = { session, controller };
      session.turns.push(turn);
      session.updated_at = turn.started_at;
      try {
        await store.save(session);
      } catch (error) {
        active = null;
        throw error;
      }
      task = execute(session, turn, controller);
      return reply.code(202).send({
        session_id: session.id,
        turn_id: turn.id,
        title: session.title,
        status: "running",
      });
    },
  );
  app.post("/api/assistant/sessions/:id/cancel", async (request) => {
    authorized(request);
    const id = validateId(request.params.id);
    if (active?.session.id === id) {
      active.controller.abort();
      return { status: "cancelling" };
    }
    return { status: "unchanged" };
  });
  app.get("/api/assistant/sessions/:id/events", async (request, reply) => {
    authorized(request);
    const session = await load(request.params.id),
      turn = session.turns.at(-1);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write("retry: 2000\n\n");
    const send = (type, event) => {
      if (reply.raw.destroyed || reply.raw.writableEnded) return;
      reply.raw.write(
        `${event.id ? `id: ${event.id}\n` : ""}event: ${type}\ndata: ${JSON.stringify(event)}\n\n`,
      );
      if (type === "done") reply.raw.end();
    };
    const listeners = subscribers.get(session.id) || new Set();
    subscribers.set(session.id, listeners);
    listeners.add(send);
    const timer = setInterval(
      () => send("heartbeat", { at: new Date().toISOString() }),
      10000,
    );
    reply.raw.on("close", () => {
      clearInterval(timer);
      listeners.delete(send);
      if (!listeners.size) subscribers.delete(session.id);
    });
    const since = Number(
      request.headers["last-event-id"] || request.query.since || 0,
    );
    for (const event of turn?.events || [])
      if (event.id > since) send(event.type, event);
    if (turn?.status !== "running")
      send("done", { status: turn?.status || "idle" });
  });
  app.get("/api/assistant/sessions/:id/download", async (request, reply) => {
    authorized(request);
    const session = await load(request.params.id),
      json = request.query.format === "json";
    reply
      .header(
        "Content-Disposition",
        `attachment; filename="session-${session.id}.${json ? "json" : "md"}"`,
      )
      .type(json ? "application/json" : "text/markdown; charset=utf-8");
    return json ? JSON.stringify(session, null, 2) : sessionMarkdown(session);
  });
  app.get(
    "/api/assistant/sessions/:id/artifacts/:artifactId/download",
    async (request, reply) => {
      authorized(request);
      const session = await load(request.params.id),
        id = validateId(request.params.artifactId);
      const artifact = session.turns
        .flatMap((t) => t.artifacts)
        .find((a) => a.id === id);
      if (!artifact) reject("找不到研究內容", 404);
      const json =
        request.query.format === "json" || artifact.type !== "report";
      reply
        .header(
          "Content-Disposition",
          `attachment; filename="research-${id}.${json ? "json" : "md"}"`,
        )
        .type(json ? "application/json" : "text/markdown; charset=utf-8");
      return json
        ? JSON.stringify(artifact, null, 2)
        : `# ${artifact.title}\n\n${artifact.markdown}\n\n資料截止：${artifact.scope.targets?.length ? artifact.scope.targets.map((t) => `${t.market}:${t.symbol} ${t.as_of}`).join("、") : artifact.scope.as_of}\n來源：${artifact.evidence_ids.join("、")}\n`;
    },
  );
  app.addHook("preClose", async () => {
    active?.controller.abort();
    await task;
    for (const listeners of subscribers.values())
      for (const send of listeners) send("done", { status: "interrupted" });
  });
  return { activeId: () => active?.session.id || null };
}
