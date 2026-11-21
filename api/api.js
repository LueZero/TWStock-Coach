import Fastify from "fastify";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import metadata from "../package.json" with { type: "json" };
import { createHash, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import {
  stock,
  validDate,
  validStamp,
  integer,
  finiteNumber,
  fail,
  now,
  taipeiDay,
  dailySourceEnd,
  addDays,
  daysBetween,
  num,
} from "./lib.js";
import { calculate as calculator } from "./calculator.js";
import { aggregate, RESOLUTIONS } from "./charting.js";
import { marketStatus, tradingRange } from "./trading.js";
import { search, getQuote, getCatalog } from "./market.js";
import { boardQuotes, boardIntraday, boardHistory } from "./market-board.js";
import { marketChips } from "./market-chips.js";
import { marketScreen } from "./market-screen.js";
import { stockMediaRange } from "./media.js";
import { evaluate, backtest } from "./strategy.js";
import { forecast } from "./research.js";
import { contract, protectedPaths } from "./contracts.js";
import { buildRuleReport } from "./report-conditions.js";
import { refreshLatestStock } from "./latest-data.js";
import { directResearch } from "./direct-research.js";
import { sourceActivity } from "./providers.js";
import {
  fundNav,
  fundPortfolio,
  fundHolders,
  fundQuarterly,
} from "./fund-data.js";
import { isEtf } from "./data-availability.js";
import {
  barsResource,
  directBars,
  directFinancial,
  directEquity,
  directPeers,
  directValuationBands,
} from "./direct-data.js";
const choice = (v, values, fallback) => {
    v ??= fallback;
    if (!values.includes(v)) fail("參數不符：" + v);
    return v;
  },
  qint = (v, min, max, fallback, label) =>
    integer(v == null ? fallback : Number(v), min, max, label),
  cutoff = (v) => {
    const stamp = v ? validStamp(v) : now();
    if (Date.parse(stamp) > Date.now()) fail("分析時間需具時區且不能在未來");
    return stamp;
  },
  dateRange = (q, { future = true, max = 3653 } = {}) => {
    validDate(q.start);
    validDate(q.end);
    if (
      q.start > q.end ||
      daysBetween(q.end, q.start) > max ||
      (!future && q.end > taipeiDay())
    )
      fail("日期區間需由早到晚且在有效範圍內");
  },
  pair = (request) => {
    stock(request.params.market, request.params.symbol);
    return [request.params.market, request.params.symbol];
  };
export async function chart(market, symbol, q, wait = true) {
  dateRange(q);
  const resolution = choice(q.resolution, RESOLUTIONS, "1d"),
    basis = choice(q.price_basis, ["raw", "adjusted"], "raw"),
    session = choice(
      q.session,
      ["regular", "intraday_odd", "afterhours_odd"],
      "regular",
    ),
    minute = resolution.endsWith("m") && resolution !== "1mo",
    periods = String(q.ma_periods ?? "5,10,20,60,120,240")
      .split(",")
      .map((v) => (/^\d+$/.test(v) ? Number(v) : NaN));
  if (
    periods.length > 12 ||
    periods.some((p) => !Number.isInteger(p) || p < 2 || p > 500)
  )
    fail("均線需為2至500期整數，最多12條");
  if (minute && (daysBetween(q.end, q.start) > 30 || basis !== "raw"))
    fail("分鐘／小時K線一次最多31日且僅支援原始價格");
  const warmup = addDays(
      q.start,
      minute
        ? -14
        : -Math.min(
            8000,
            Math.max(
              420,
              Math.max(...periods) *
                { "1d": 2, "1w": 8, "1mo": 32 }[resolution],
            ),
          ),
    ),
    source = barsResource(market, symbol, {
      timeframe: minute ? "1m" : "1d",
      session: minute ? session : "daily_aggregate",
      price_basis: basis,
      start: warmup,
      end: q.end,
    }),
    asOf = new Date(
      Math.min(Date.now(), Date.parse(addDays(q.end, 1) + "T00:00:00+08:00")),
    );
  if (wait) await source.promise;
  const data = source.value?.bars || [];
  return {
    data: aggregate(data, resolution, asOf, periods).filter(
      (r) => q.start <= r.trade_date && r.trade_date <= q.end,
    ),
    resolution,
    timezone: "Asia/Taipei",
    range: { start: q.start, end: q.end },
    source_kind: "source_api",
    storage: "memory",
    database_used: false,
    source_state: source.pending
      ? "updating"
      : source.error
        ? source.value
          ? "partial"
          : "unavailable"
        : "ready",
    source_warning: source.error || source.value?.warnings?.join("；") || null,
    source_error_code: source.error_code || null,
    received_at: source.received_at || null,
    note: minute
      ? "分鐘資料需授權來源；沒有成交或缺漏分鐘不補零。聚合完成表示區間已結束，不保證資料無缺漏。"
      : "均線按所選週期的完成 K 線計算。",
  };
}
export function authorize(key) {
  const expected = config.ingestKey;
  if (
    !expected ||
    !timingSafeEqual(
      createHash("sha256")
        .update(String(key ?? ""))
        .digest(),
      createHash("sha256").update(expected).digest(),
    )
  )
    fail("資料匯入需要有效的 X-API-Key", 401);
}
export function validateResearchImport(r) {
  stock(r.market, r.symbol);
  choice(r.dataset, ["AnalystTargetReport", "FundHoldingsReport"]);
  if (
    typeof r.source !== "string" ||
    !r.source.trim() ||
    r.source.length > 64 ||
    !Array.isArray(r.rows) ||
    r.rows.length < 1 ||
    r.rows.length > 10000
  )
    fail("揭露來源或批次大小不符");
  for (const row of r.rows) {
    if (
      !row ||
      row.stock_id !== r.symbol ||
      validDate(row.date) > taipeiDay() ||
      typeof row.source_url !== "string" ||
      row.source_url.length > 2048
    )
      fail("揭露需相符股票、有效日期及HTTPS來源");
    let url;
    try {
      url = new URL(row.source_url);
    } catch {
      fail("揭露來源網址不符");
    }
    if (url.protocol !== "https:") fail("揭露來源需HTTPS");
    if (r.dataset === "AnalystTargetReport") {
      if (
        typeof row.institution !== "string" ||
        !row.institution.trim() ||
        row.institution.length > 200 ||
        row.currency !== "TWD" ||
        !(num(row.target_price) > 0)
      )
        fail("目標價需機構、TWD與正價格");
    } else {
      if (
        ["fund_code", "fund_name"].some(
          (k) =>
            typeof row[k] !== "string" || !row[k].trim() || row[k].length > 200,
        ) ||
        !Number.isSafeInteger(num(row.holding_shares)) ||
        num(row.holding_shares) < 0 ||
        (row.weight_percent != null &&
          (num(row.weight_percent) == null ||
            num(row.weight_percent) < 0 ||
            num(row.weight_percent) > 100))
      )
        fail("基金持股需代碼、名稱、整數股數及有效權重");
    }
  }
  return r;
}
export function validateStrategy(r) {
  r = {
    resolution: "1d",
    price_basis: "raw",
    shares: 0,
    risk_budget: 1000,
    fee_bps: 10,
    slippage_bps: 5,
    sell_tax_bps: 0,
    cost: null,
    initial_stop: null,
    peak: null,
    selected_timestamp: null,
    ...r,
  };
  stock(r.market, r.symbol);
  dateRange(r);
  integer(r.shares, 0, 1e8, "持倉股數");
  for (const k of ["cost", "initial_stop", "peak"])
    if (r[k] != null) r[k] = finiteNumber(r[k], Number.MIN_VALUE, 1e6, k);
  r.risk_budget = finiteNumber(
    r.risk_budget,
    Number.MIN_VALUE,
    1e8,
    "風險預算",
  );
  for (const k of ["fee_bps", "slippage_bps", "sell_tax_bps"])
    r[k] = finiteNumber(r[k], 0, 100, k);
  if (r.shares > 0 && r.cost == null) fail("有持倉股數時請輸入成本");
  if (r.selected_timestamp)
    r.selected_timestamp = validStamp(r.selected_timestamp);
  return r;
}
export async function createApp({ logger = false } = {}) {
  const app = Fastify({
    logger,
    bodyLimit: 8 * 1024 * 1024,
    requestTimeout: 60000,
    ajv: { customOptions: { coerceTypes: false } },
  });
  app.addHook("preHandler", async (request) => {
    if (
      request.method === "POST" &&
      ["/api/ingest", "/api/equity/import"].includes(request.url.split("?")[0])
    )
      fail("來源API模式停用資料庫匯入，未寫入任何資料", 410);
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "股票智能助手",
        version: metadata.version,
        description: "Node.js行情、財務、籌碼分析與可追溯研究API",
      },
      components: {
        securitySchemes: {
          ingestKey: { type: "apiKey", in: "header", name: "X-API-Key" },
        },
      },
    },
  });
  await app.register(swaggerUI, {
    routePrefix: "/docs",
    staticCSP: true,
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
      persistAuthorization: false,
    },
  });
  app.setErrorHandler((error, request, reply) => {
    const status = error.validation ? 422 : (error.statusCode ?? 500);
    if (status >= 500)
      request.log.error({ code: error.code ?? "internal" }, "Request failed");
    reply.code(status).send({
      detail:
        status >= 500 && !error.statusCode
          ? "服務暫時無法完成請求，請稍後再試"
          : error.message,
    });
  });
  const get = (path, handler) =>
      app.get(path, { schema: contract(path, "GET") }, handler),
    post = (path, handler) =>
      app.post(
        path,
        {
          schema: contract(path, "POST"),
          ...(protectedPaths.has(path)
            ? {
                onRequest: async (request) =>
                  authorize(request.headers["x-api-key"]),
              }
            : {}),
        },
        handler,
      );
  get("/", () => ({
    service: "TWStock Coach API",
    version: metadata.version,
    docs: "/docs",
    health: "/health",
  }));
  get("/openapi.json", () => app.swagger());
  get("/health", async () => {
    return {
      status: "ok",
      timezone: "Asia/Taipei",
      runtime: "nodejs",
      data_mode: "source_api",
      source_activity: sourceActivity(),
      database_used: false,
    };
  });
  get("/api/market/status", () => marketStatus());
  get("/api/market/board", () => boardQuotes());
  get("/api/market/chips", (request) => {
    const day = validDate(request.query.date || taipeiDay());
    if (day > taipeiDay()) fail("不支援未來日期");
    return marketChips(day);
  });
  get("/api/media/:market/:symbol", (request) => {
    const [market, symbol] = pair(request);
    return stockMediaRange(market, symbol, request.query);
  });
  get("/api/market/board/chart", async (request) => {
    const q = request.query;
    const product = choice(q.product, ["index", "day", "night"], "index");
    const mode = choice(q.mode, ["intraday", "history"], "intraday");
    if (mode === "history") {
      dateRange(q, { future: false, max: 366 });
      if (
        product !== "index" &&
        !/^\d{4}(0[1-9]|1[0-2])$/.test(q.contract ?? "")
      )
        fail("請選擇有效契約月份");
      return boardHistory(product, q.start, q.end, q.contract);
    }
    const symbol = product === "index" ? "TXF-S" : q.symbol;
    if (
      product !== "index" &&
      !new RegExp(
        "^TXF[A-L]\\d-" + (product === "night" ? "M" : "F") + "$",
      ).test(symbol ?? "")
    )
      fail("期貨契約與盤別不符");
    return boardIntraday(symbol, product);
  });
  get("/api/market/range", (request) => {
    const end = validDate(request.query.end);
    if (end > taipeiDay()) fail("截止日期不能晚於今日", 400);
    return tradingRange(
      end,
      qint(request.query.sessions, 1, 240, 7, "交易日数"),
    );
  });
  get("/api/instruments", () => getCatalog());
  get("/api/search", (request) => {
    const q = request.query.q ?? "";
    if (typeof q !== "string" || q.length > 40) fail("搜尋內容最多40字");
    return search(q.trim());
  });
  get("/api/market/screen", (request) => marketScreen(request.query));
  post("/api/calculator", (request) => calculator(request.body ?? {}));
  get("/api/quote/:market/:symbol", (request) => getQuote(...pair(request)));
  get("/api/intraday/:market/:symbol", async (request) => {
    const [market, symbol] = pair(request),
      day = validDate(request.query.day ?? taipeiDay()),
      snapshots = [];
    return {
      trade_date: day,
      kind: "sampled_snapshots",
      description: "開始查看後收集的公開快照，非完整逐筆或分鐘 K 線",
      data: snapshots.map((r) =>
        Object.fromEntries(
          [
            "market",
            "symbol",
            "last_price",
            "volume_shares",
            "trade_date",
            "source_time",
            "trade_time",
          ].map((k) => [k, r.data[k] ?? null]),
        ),
      ),
    };
  });
  post("/api/history/load", async () =>
    fail("來源API模式不使用DB工作佇列，請查詢stock-data資料接口", 410),
  );
  get("/api/stock-data/:market/:symbol", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const [market, symbol] = pair(request),
      q = request.query;
    const section = choice(
      q.section,
      ["chart", "financial", "equity", "basic"],
      "chart",
    );
    const historical = Boolean(q.as_of);
    if (historical) cutoff(q.as_of);
    if (section === "chart") {
      if (historical)
        fail("K線區間回看不提供as_of修訂快照，請使用研究資料接口");
      const resolution = choice(q.resolution, RESOLUTIONS, "1d");
      const minute = resolution.endsWith("m") && resolution !== "1mo";
      const data = await chart(market, symbol, q, false);
      return {
        data,
        state: data.source_state,
        storage: "memory",
        database_used: false,
        update: {
          status:
            data.source_state === "updating"
              ? "running"
              : data.source_state === "unavailable"
                ? "failed"
                : "success",
          message: data.source_warning,
        },
      };
    }
    if (section === "financial")
      return directFinancial(
        market,
        symbol,
        q.as_of,
        q.include_raw === "true",
        q.background === "true",
      );
    dateRange(q, { future: false });
    return directEquity(market, symbol, q.start, q.end, q.as_of, section);
  });
  get("/api/chart/:market/:symbol", (request) =>
    chart(...pair(request), request.query),
  );
  get("/api/jobs", () => []);
  get("/api/jobs/:id", async () => fail("來源API模式沒有DB工作紀錄", 410));
  post("/api/fundamentals/load", async () =>
    fail("來源API模式不使用DB工作佇列", 410),
  );
  get("/api/fundamentals/:market/:symbol", async (request) => {
    const flag = choice(request.query.include_raw, ["true", "false"], "false");
    if (request.query.as_of) cutoff(request.query.as_of);
    return (
      await directFinancial(
        ...pair(request),
        request.query.as_of,
        flag === "true",
      )
    ).data;
  });
  post("/api/equity/load", async () =>
    fail("來源API模式不使用DB工作佇列", 410),
  );
  get("/api/equity/:market/:symbol", async (request) => {
    dateRange(request.query, { future: false });
    if (request.query.as_of) cutoff(request.query.as_of);
    return (
      await directEquity(
        ...pair(request),
        request.query.start,
        request.query.end,
        request.query.as_of,
      )
    ).data;
  });
  post("/api/equity/import", async (request) => {
    authorize(request.headers["x-api-key"]);
    fail("此匯入介面已移除；股票資料由來源 API 按需取得。", 410);
  });
  get("/api/valuation-bands/:market/:symbol", async (request) => {
    const [market, symbol] = pair(request),
      q = request.query;
    if (isEtf(symbol)) fail("ETF 不適用公司估值倍數");
    dateRange(q, { future: false, max: 1826 });
    return directValuationBands(
      market,
      symbol,
      q.start,
      q.end,
      choice(q.field, ["PER", "PBR"], "PER"),
    );
  });
  get("/api/fund-data/:market/:symbol", async (request) => {
    const [market, symbol] = pair(request),
      q = request.query;
    const section = choice(
      q.section,
      ["nav", "portfolio", "holders", "quarterly"],
      "nav",
    );
    const end = q.end || taipeiDay(),
      start = q.start || addDays(end, -365);
    dateRange({ start, end }, { future: false, max: 3653 });
    if (
      !(await getCatalog()).some(
        (i) => i.market === market && i.symbol === symbol,
      )
    )
      fail("股票目錄沒有此市場與代號", 404);
    if (section !== "holders" && !isEtf(symbol)) fail("請選擇 ETF 代號");
    if (section === "nav") return fundNav(market, symbol, start, end);
    if (section === "portfolio") return fundPortfolio(market, symbol, end);
    if (section === "quarterly") return fundQuarterly(market, symbol, end);
    return fundHolders(market, symbol, end);
  });
  get("/api/peers/:market/:symbol", (request) => {
    const q = request.query,
      reference = validDate(q.reference);
    if (reference > taipeiDay()) fail("比較日期不能晚於今天");
    const requested = q.symbols ? String(q.symbols).split(",") : null;
    if (
      requested &&
      (q.symbols.length > 10000 ||
        requested.some((k) => !/^(TWSE|TPEX):[A-Za-z0-9]{2,16}$/.test(k)) ||
        new Set([
          ...requested,
          request.params.market + ":" + request.params.symbol,
        ]).size > 400)
    )
      fail("比較代號格式不符或超過400檔");
    return directPeers(
      ...pair(request),
      reference,
      choice(q.view_mode, ["latest", "historical"], "latest"),
      choice(q.alignment, ["common", "latest"], "common"),
      requested,
    );
  });
  get("/api/bars/:market/:symbol", async (request) => {
    const q = request.query,
      o = {
        timeframe: choice(q.timeframe, ["1d", "1m"], "1d"),
        session: choice(
          q.session,
          ["daily_aggregate", "regular", "intraday_odd", "afterhours_odd"],
          "daily_aggregate",
        ),
        price_basis: choice(q.price_basis, ["raw", "adjusted"], "raw"),
        start: q.start ? validDate(q.start) : null,
        end: q.end ? validDate(q.end) : null,
        limit: qint(q.limit, 1, 5000, 500, "筆數"),
        analysis: true,
      };
    if (o.start && o.end && o.start > o.end) fail("開始日期不能晚於截止");
    const data = await directBars(...pair(request), {
        ...o,
        start: o.start || addDays(taipeiDay(), -180),
        end: o.end || taipeiDay(),
      }),
      latest = data.at(-1);
    return {
      data,
      timezone: "Asia/Taipei",
      freshness: latest
        ? {
            state:
              o.timeframe === "1d"
                ? "historical_daily"
                : Date.now() - Date.parse(latest.source_time) > 180000
                  ? "delayed"
                  : "recent",
            age_seconds: Math.max(
              0,
              (Date.now() - Date.parse(latest.source_time)) / 1000,
            ),
            source: latest.source,
            source_time: latest.source_time,
            received_at: latest.received_at,
            is_final: latest.is_final,
            live_feed_connected: false,
          }
        : { state: "no_data" },
    };
  });
  post("/api/strategy/analyze", async (request) => {
    const r = validateStrategy(request.body ?? {}),
      data = (await chart(r.market, r.symbol, r)).data,
      row = r.selected_timestamp
        ? data.find(
            (b) => Date.parse(b.timestamp) === Date.parse(r.selected_timestamp),
          )
        : data.findLast((b) => b.is_final);
    if (!row) fail("所選區間沒有可分析的K線");
    const c = new Date(
        Math.min(Date.now(), Date.parse(row.end_time)),
      ).toISOString(),
      financial = (await directFinancial(r.market, r.symbol, c)).data;
    return {
      ...evaluate(
        row,
        financial,
        r.cost,
        r.shares,
        r.initial_stop,
        r.peak,
        r.risk_budget,
      ),
      resolution: r.resolution,
      fundamental_as_of: financial.as_of,
      fundamental_coverage: financial.coverage,
      source_revisions: row.source_revisions,
    };
  });
  post("/api/strategy/backtest", async (request) => {
    const r = validateStrategy(request.body ?? {}),
      data = (await chart(r.market, r.symbol, r)).data;
    if (!data.length) fail("所選區間尚無行情，請先載入歷史資料");
    return {
      ...backtest(data, r.fee_bps, r.slippage_bps, r.sell_tax_bps),
      resolution: r.resolution,
      price_basis: r.price_basis,
      range: { start: r.start, end: r.end },
      data_range: { start: data[0].trade_date, end: data.at(-1).trade_date },
      input_revisions: data.map((b) => ({
        timestamp: b.timestamp,
        revisions: b.source_revisions,
      })),
    };
  });
  get("/api/research/:market/:symbol", async (request) => {
    const data = (
      await directBars(...pair(request), {
        timeframe: "1d",
        session: "daily_aggregate",
        price_basis: "adjusted",
        limit: 1500,
        start: addDays(taipeiDay(), -1826),
        end: dailySourceEnd(),
      })
    ).filter((b) => b.is_final);
    return {
      ...forecast(data),
      input_revisions: data.map((b) => ({ id: b.id, revision: b.revision })),
    };
  });
  post("/api/ingest", (request) => {
    authorize(request.headers["x-api-key"]);
    fail("此寫入介面已移除；股票資料由來源 API 按需取得。", 410);
  });
  app.post(
    "/api/research/report-input",
    { bodyLimit: 16384 },
    async (request) => {
      const body = request.body || {};
      stock(body.market, body.symbol);
      const refresh =
        (body.mode || "latest") === "latest"
          ? await refreshLatestStock(body.market, body.symbol)
          : null;
      const input = await directResearch(request.body);
      if (refresh?.status === "stale")
        fail(
          `最新日K尚未就緒：目前 ${refresh.data_date || "無資料"}，預期 ${refresh.expected_day}；來源狀態 ${refresh.provider_status}，請稍後再試。`,
          503,
        );
      if (refresh) input.latest_refresh = refresh;
      return { input, report: buildRuleReport(input) };
    },
  );
  app.post("/api/research/refresh/:market/:symbol", async (request) => {
    stock(request.params.market, request.params.symbol);
    return refreshLatestStock(request.params.market, request.params.symbol);
  });
  return app;
}
