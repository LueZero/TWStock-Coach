import Fastify from "fastify";
import {
  randomUUID,
  createHmac,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { createReportStore, validateId } from "./report-store.js";
import { codexHealth, runCodex, PROMPT_VERSION } from "./codex-adapter.js";
import { validateExplanation } from "./report-schema.js";

const fail = (message, statusCode = 422) => {
  throw Object.assign(Error(message), { statusCode });
};
const hash = (value) => createHash("sha256").update(value).digest();
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  timingSafeEqual(hash(a), hash(b));
export function createAgent({
  directory = process.env.ASSISTANT_REPORT_DIR || "reports",
  accessKey = process.env.ASSISTANT_ACCESS_KEY || "",
  health = codexHealth,
  run = runCodex,
} = {}) {
  const app = Fastify({ bodyLimit: 2 * 1024 * 1024, logger: false });
  const store = createReportStore(directory);
  let active = null;
  const origins = (
    process.env.ASSISTANT_ALLOWED_ORIGINS ||
    "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173"
  ).split(",");
  const sign = (value) =>
    createHmac("sha256", accessKey).update(value).digest("hex");
  function origin(request) {
    if (
      request.headers["sec-fetch-site"] === "cross-site" ||
      (request.headers.origin && !origins.includes(request.headers.origin))
    )
      fail("不接受此來源的請求", 403);
  }
  function authorized(request) {
    origin(request);
    if (accessKey.length < 24)
      fail("請設定平台存取密碼ASSISTANT_ACCESS_KEY", 503);
    const token =
      /(?:^|;\s*)assistant_session=(\d+)\.([a-f0-9]{64})(?:;|$)/.exec(
        request.headers.cookie || "",
      );
    if (
      !token ||
      Number(token[1]) < Date.now() ||
      !equal(token[2], sign(token[1]))
    )
      fail("請先解鎖AI助手", 401);
  }
  app.setErrorHandler((error, _request, reply) =>
    reply.code(error.statusCode || 500).send({
      detail: error.statusCode
        ? error.message
        : "助手處理失敗，報告檔案仍保留；請檢查服務日誌。",
    }),
  );
  app.get("/api/assistant/status", async (request) => {
    const value = await health();
    let authenticated = false;
    try {
      authorized(request);
      authenticated = true;
    } catch {}
    return {
      ...value,
      configured: accessKey.length >= 24,
      connected: true,
      authenticated,
      active_report: authenticated ? (active?.id ?? null) : undefined,
    };
  });
  const attempts = new Map();
  app.post(
    "/api/assistant/login",
    { bodyLimit: 4096 },
    async (request, reply) => {
      origin(request);
      if (accessKey.length < 24)
        fail("請先執行npm run assistant:setup並重啟agent", 503);
      for (const [ip, t] of attempts)
        if (t.until < Date.now()) attempts.delete(ip);
      const t = attempts.get(request.ip) || {
        n: 0,
        until: Date.now() + 600000,
      };
      t.n++;
      attempts.set(request.ip, t);
      if (t.n > 10) fail("嘗試次數過多，十分鐘後再試", 429);
      if (!equal(request.body?.access_key, accessKey))
        fail("平台存取密碼不符", 401);
      attempts.delete(request.ip);
      const expires = String(Date.now() + 43200000);
      reply.header(
        "Set-Cookie",
        `assistant_session=${expires}.${sign(expires)}; HttpOnly; SameSite=Strict; Path=/api/assistant; Max-Age=43200${process.env.ASSISTANT_COOKIE_SECURE === "true" ? "; Secure" : ""}`,
      );
      return { authenticated: true };
    },
  );
  app.post("/api/assistant/logout", async (request, reply) => {
    origin(request);
    reply.header(
      "Set-Cookie",
      "assistant_session=; HttpOnly; SameSite=Strict; Path=/api/assistant; Max-Age=0",
    );
    return { authenticated: false };
  });
  const message = (value) => {
    if (typeof value !== "string" || !value.trim() || value.length > 2000)
      fail("訊息需為1至2000字");
    return value.trim();
  };
  async function load(id) {
    const doc = await store.load(id);
    if (doc.run.status === "running" && active?.id !== id) {
      doc.run = {
        ...doc.run,
        status: "interrupted",
        error: "agent已中斷；原報告保留，請手動重新分析或追問。",
      };
      await store.save(doc);
    }
    return doc;
  }
  async function execute(doc, text, kind, service) {
    const controller = new AbortController(),
      id = doc.report.id;
    active = { id, controller };
    try {
      const response = await run(
        {
          kind,
          message: text,
          report: doc.report,
          session_id: doc.session_id || null,
        },
        {
          signal: controller.signal,
          onPrepared: async (prepared) => {
            doc.analysis_inputs = [...(doc.analysis_inputs || []), prepared];
            doc.report.input_manifest = prepared.manifest;
            doc.run.phase = "analyzing";
            await store.save(doc);
          },
        },
      );
      if (controller.signal.aborted) throw Error("已取消分析");
      const calls = response.tool_calls || [];
      doc.tool_calls = [...(doc.tool_calls || []), ...calls];
      for (const call of calls.filter((c) => c.status === "completed")) {
        for (const evidence of call.evidence || [])
          if (!doc.report.evidence.some((e) => e.id === evidence.id))
            doc.report.evidence.push(evidence);
        if (!doc.report.evidence.some((e) => e.id === call.evidence_id))
          doc.report.evidence.push({
            id: call.evidence_id,
            category: "tool",
            label: `${call.name} ${call.arguments.section || call.arguments.metric || call.arguments.dataset || "清單"}`,
            as_of: call.as_of,
            received_at: call.queried_at,
            source: call.endpoint,
            data: { ...call.data, evidence: call.evidence || [] },
          });
      }
      const fresh = calls.filter(
        (c) => c.status === "completed" && c.evidence_id,
      );
      const technical = fresh.find((c) => c.arguments.section === "technical");
      const scenario = fresh.find((c) => c.arguments.section === "scenarios");
      const validationReport = calls.length
        ? {
            evidence: fresh.flatMap((c) => [
              { id: c.evidence_id, data: c.data },
              ...(c.evidence || []),
            ]),
            metrics: technical?.data.metrics || {},
            scenarios: scenario?.data.scenarios || [],
            holding: scenario?.data.holding,
            observations: technical?.data.observations || [],
            chart_bars: [],
            user_message: text,
            query_windows: fresh.map((c) => ({ start: c.start, end: c.end })),
          }
        : doc.report;
      const result = validateExplanation(response.result, validationReport);
      doc.session_id = response.session_id || doc.session_id || null;
      const content = {
        ...result,
        usage: response.usage,
        created_at: new Date().toISOString(),
        analysis_scope: response.scope,
        input_manifest: doc.analysis_inputs?.at(-1)?.manifest || [],
        tool_evidence_ids: calls
          .filter((c) => c.status === "completed")
          .map((c) => c.evidence_id),
      };
      doc.messages.push({ role: "assistant", content });
      if (kind === "report")
        doc.report.ai = {
          ...content,
          generated_at: content.created_at,
          provider: "Codex CLI",
          cli_version: service.version,
          prompt_version: PROMPT_VERSION,
          model: process.env.ASSISTANT_MODEL || "CLI default",
          session_id: doc.session_id,
        };
      doc.run = {
        status: "completed",
        kind,
        usage: response.usage,
        finished_at: new Date().toISOString(),
        error: null,
      };
    } catch (e) {
      if (e.tool_calls)
        doc.tool_calls = [...(doc.tool_calls || []), ...e.tool_calls];
      doc.run = {
        status: controller.signal.aborted ? "cancelled" : "failed",
        kind,
        error: e.message,
        finished_at: new Date().toISOString(),
      };
    }
    try {
      await store.save(doc);
    } catch (e) {
      console.error(
        "Agent：無法保存報告；請檢查reports目錄權限與空間。",
        e.code || "unknown",
      );
    } finally {
      if (active?.id === id) active = null;
    }
  }
  async function ready() {
    if (active) fail("已有分析執行中，請完成或取消後再送出", 409);
    const service = await health();
    if (active) fail("已有分析執行中，請完成或取消後再送出", 409);
    return service;
  }
  app.get("/api/assistant/reports", async (request) => {
    authorized(request);
    return store.list(request.query.market, request.query.symbol);
  });
  app.post("/api/assistant/reports", async (request, reply) => {
    authorized(request);
    const service = await ready(),
      { report, input } = request.body || {},
      text = message(request.body?.message || input?.message);
    if (
      !report ||
      !input ||
      !["TWSE", "TPEX"].includes(report.meta?.market) ||
      typeof report.meta.symbol !== "string" ||
      !/^[A-Za-z0-9._-]{1,16}$/.test(report.meta.symbol) ||
      !Array.isArray(report.evidence) ||
      !Array.isArray(report.scenarios) ||
      !Array.isArray(report.chart_bars) ||
      report.meta.market !== input.market ||
      report.meta.symbol !== input.symbol ||
      report.meta.as_of !== input.as_of
    )
      fail("分析資料包不符，請從股票平台重新取得");
    report.id = randomUUID();
    report.snapshot_id =
      "sha256:" +
      createHash("sha256").update(JSON.stringify(input)).digest("hex");
    report.ai = null;
    const doc = {
      format_version: 1,
      report,
      input,
      session_id: null,
      messages: [{ role: "user", content: { text } }],
      run: {
        status: service.ready ? "running" : "unavailable",
        kind: "report",
        error: service.ready ? null : service.note,
      },
    };
    // Reserve before awaiting disk I/O so concurrent requests cannot start another CLI.
    active = { id: report.id, controller: new AbortController() };
    try {
      await store.save(doc);
    } catch (e) {
      active = null;
      throw e;
    }
    if (service.ready) void execute(doc, text, "report", service);
    else active = null;
    return reply
      .code(202)
      .send({ report, status: service.ready ? "running" : "unavailable" });
  });
  app.get("/api/assistant/reports/:id", async (request) => {
    authorized(request);
    const doc = await load(validateId(request.params.id));
    return {
      report: doc.report,
      messages: doc.messages,
      run: doc.run,
      session_id: doc.session_id,
      tool_calls: doc.tool_calls || [],
      analysis_inputs: (doc.analysis_inputs || []).map(
        ({ scope, manifest, template_version, prepared_at }) => ({
          scope,
          manifest,
          template_version,
          prepared_at,
        }),
      ),
    };
  });
  app.get("/api/assistant/reports/:id/download", async (request, reply) => {
    authorized(request);
    const id = validateId(request.params.id),
      doc = await load(id);
    const json = request.query.format === "json";
    reply
      .header(
        "Content-Disposition",
        `attachment; filename="${doc.report.meta.symbol}-${id}.${json ? "json" : "md"}"`,
      )
      .type(json ? "application/json" : "text/markdown; charset=utf-8");
    return json ? JSON.stringify(doc, null, 2) : await store.markdown(id);
  });
  app.post(
    "/api/assistant/reports/:id/messages",
    { bodyLimit: 4096 },
    async (request, reply) => {
      authorized(request);
      const text = message(request.body?.message);
      const doc = await load(validateId(request.params.id));
      const service = await ready();
      doc.messages.push({ role: "user", content: { text } });
      doc.run = {
        status: service.ready ? "running" : "unavailable",
        kind: doc.report.ai ? "question" : "report",
        error: service.ready ? null : service.note,
      };
      active = { id: doc.report.id, controller: new AbortController() };
      try {
        await store.save(doc);
      } catch (e) {
        active = null;
        throw e;
      }
      if (service.ready) void execute(doc, text, doc.run.kind, service);
      else active = null;
      return reply.code(202).send({
        status: service.ready ? "running" : "unavailable",
        report_id: doc.report.id,
      });
    },
  );
  app.post("/api/assistant/reports/:id/cancel", async (request) => {
    authorized(request);
    const id = validateId(request.params.id);
    if (active?.id === id) {
      active.controller.abort();
      return { status: "cancelling" };
    }
    return { status: "unchanged" };
  });
  app.addHook("onClose", async () => {
    active?.controller.abort();
  });
  return app;
}
