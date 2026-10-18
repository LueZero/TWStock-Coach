import Fastify from "fastify";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { createReportStore, validateId } from "./report-store.js";
import { codexHealth } from "./codex-adapter.js";
import { registerChatRoutes } from "./chat-routes.js";

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
  chatRun,
  sessionDirectory,
} = {}) {
  const app = Fastify({ bodyLimit: 2 * 1024 * 1024, logger: false });
  const store = createReportStore(directory);
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
        : "助手處理失敗，已存對話保留；請檢查服務日誌。",
    }),
  );
  const chat = registerChatRoutes(app, {
    authorized,
    health,
    directory: sessionDirectory,
    run: chatRun,
  });
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
      active_report: authenticated ? null : undefined,
      active_session: authenticated ? chat.activeId() : undefined,
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

  app.get("/api/assistant/reports", async (request) => {
    authorized(request);
    return store.list(request.query.market, request.query.symbol);
  });
  app.get("/api/assistant/reports/:id", async (request) => {
    authorized(request);
    return store.load(validateId(request.params.id));
  });
  app.get("/api/assistant/reports/:id/download", async (request, reply) => {
    authorized(request);
    const id = validateId(request.params.id),
      json = request.query.format === "json",
      doc = await store.load(id);
    reply
      .header(
        "Content-Disposition",
        `attachment; filename="${doc.report.meta.symbol}-${id}.${json ? "json" : "md"}"`,
      )
      .type(json ? "application/json" : "text/markdown; charset=utf-8");
    return json ? JSON.stringify(doc, null, 2) : store.markdown(id);
  });
  for (const path of [
    "/api/assistant/reports",
    "/api/assistant/reports/:id/messages",
    "/api/assistant/reports/:id/cancel",
  ])
    app.post(path, async (request) => {
      authorized(request);
      fail("已改用獨立Chat Session；舊報告僅供讀取與下載。", 410);
    });
  return app;
}
