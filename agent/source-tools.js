import { createHash } from "node:crypto";
import { EVENT_VERSION } from "../api/technical-events.js";
import { calculateTrade } from "./trade-math.js";
import { toolDefinitions } from "./tools.js";
import { isEtf } from "../api/data-availability.js";
import { createStockApiClient } from "./stock-api-client.js";

const date = { type: "string", maxLength: 10 };
const chipPages = {
  institutions: ["法人買賣", "TaiwanStockInstitutionalInvestorsBuySell"],
  main: ["主力代理", "TaiwanStockBrokerDailyConcentration"],
  branches: ["券商分點", "TaiwanStockTradingDailyReport"],
  ownership: ["大戶散戶", "TaiwanStockHoldingSharesPer"],
  structure: ["籌碼分布與持股結構", "TaiwanStockShareholding"],
  margin: ["融資融券", "TaiwanStockMarginPurchaseShortSale"],
  directors: ["董監持股", "DirectorHoldingsReport"],
  director_history: ["董監歷史", "DirectorHoldingsReport"],
  transfers: ["申報轉讓", "InsiderTransfersReport"],
  funds: ["指定基金持股", "TaiwanStockActiveETFHolding"],
  fund_history: ["指定基金歷史", "TaiwanStockActiveETFHolding"],
};
const object = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
export const sourceToolDefinitions = [
  ...toolDefinitions.map((t) => ({
    ...t,
    description:
      t.name === "get_stock_data"
        ? "按需直接查來源API：overview/basic基本資料、technical完成日K與指標、financial財務摘要、chips籌碼、peers同業、news區間新聞、market大盤。各區塊獨立查詢，不先載入整包報告。狀態updating需稍後重查，不能當無資料；不提供歷史當時可得快照。technical最新頁offset=0，往回分頁；其他清單往後分頁。"
        : t.name === "get_financial_history"
          ? "查財務指標歷史，或依page取得財務分類中的整個細項（多指標、歷史與報表證據）。不傳metric/page先列目錄，兩者擇一。預設offset=0最近頁，頁內依日期升序，可用order=asc從最早頁查。日期是報表期間，不是當時可得快照。"
          : t.description.replace(
              "歷史截止與來源時間沿用本次研究範圍。",
              "來源為現在取得的歷史序列，不代表歷史當時已公布。",
            ),
    inputSchema: {
      ...t.inputSchema,
      properties: {
        ...t.inputSchema.properties,
        ...(t.name === "calculate_trade_profit"
          ? {}
          : {
              start: date,
              end: date,
              wait_ms: {
                type: "integer",
                minimum: 0,
                maximum: 15000,
                description:
                  "等待來源漸進載入的上限毫秒，預設8000；仍在載入會保留狀態，不判成無資料。",
              },
            }),
        ...(["get_financial_history", "get_chip_detail"].includes(t.name)
          ? {
              order: {
                type: "string",
                enum: ["asc", "desc"],
                description:
                  "預設desc先看最近頁，頁內仍按時間升序；asc從最早頁開始。",
              },
            }
          : {}),
        ...(t.name === "get_financial_history"
          ? {
              page: {
                type: "string",
                maxLength: 80,
                description:
                  "財務目錄的page id，例如income-statement、cash-flow-statement；以實際目錄為準。與metric擇一。",
              },
            }
          : {}),
        ...(t.name === "get_stock_data"
          ? {
              section: {
                ...t.inputSchema.properties.section,
                enum: t.inputSchema.properties.section.enum.filter(
                  (section) => section !== "scenarios",
                ),
              },
              cursor: date,
              source: { type: "string", enum: ["all", "recent", "index"] },
              symbols: {
                type: "string",
                maxLength: 1000,
                description:
                  "同業比較可明傳逗號分隔TWSE:2330,TWSE:2303；先查候選，再各自查財務使來源快取有值後重查比較。",
              },
            }
          : {}),
      },
    },
  })),
  {
    name: "get_fund_data",
    description:
      "查ETF淨值/折溢價nav、公開日組合portfolio、季度揭露quarterly，或個股被已接基金持有holders。來源涵蓋非全市場，保留估值日與缺漏；季度權重無代號/股數時不猜測。",
    inputSchema: object(
      {
        section: {
          type: "string",
          enum: ["nav", "portfolio", "quarterly", "holders"],
        },
        start: date,
        end: date,
        offset: { type: "integer", minimum: 0, maximum: 10000 },
        limit: { type: "integer", minimum: 1, maximum: 120 },
      },
      ["section"],
    ),
  },
  {
    name: "get_valuation_bands",
    description:
      "查公司來源PER/PBR換算參考帶，不是完整EPS/BVPS河流圖或合理價。缺有效倍數不補值；不適用ETF。",
    inputSchema: object(
      {
        field: { type: "string", enum: ["PER", "PBR"] },
        start: date,
        end: date,
        offset: { type: "integer", minimum: 0, maximum: 10000 },
        limit: { type: "integer", minimum: 1, maximum: 120 },
      },
      ["field"],
    ),
  },
  {
    name: "run_strategy_backtest",
    description:
      "使用平台既定策略回放已完成歷史K線，非AI任意策略、未來預測或交易指令。明傳費率與滑價bps假設，結果保留成交及公司行動限制。",
    inputSchema: object(
      {
        start: date,
        end: date,
        fee_bps: { type: "number", minimum: 0, maximum: 100 },
        slippage_bps: { type: "number", minimum: 0, maximum: 100 },
        sell_tax_bps: { type: "number", minimum: 0, maximum: 100 },
      },
      ["start", "end", "fee_bps", "slippage_bps", "sell_tax_bps"],
    ),
  },
];

// Chat reads the same source endpoints as the workspace. No report snapshot,
// ingestion job, database or second model loop is involved.
export function createSourceTools(
  context,
  { fetcher = fetch, onCall = async () => {}, signal } = {},
) {
  const scope = context.scope,
    cache = new Map();
  if (
    !scope ||
    !["latest", "historical"].includes(scope.mode) ||
    !["TWSE", "TPEX"].includes(scope.market) ||
    typeof scope.symbol !== "string" ||
    !/^[A-Za-z0-9._-]{1,16}$/.test(scope.symbol) ||
    !Number.isFinite(Date.parse(scope.as_of))
  )
    throw Error("研究範圍不符");
  const base = new URL(context.api_url);
  const client = createStockApiClient(context.api_url, { fetcher, signal });
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw Error("股票API網址設定不符");
  async function request(path, body) {
    const key = path + JSON.stringify(body || null);
    if (!cache.has(key)) cache.set(key, client.request(path, body));
    try {
      const value = await cache.get(key);
      if (
        [
          value.state,
          value.source_status,
          value.source_state,
          value.data?.source_state,
        ].includes("updating")
      )
        cache.delete(key);
      return value;
    } catch (error) {
      cache.delete(key);
      throw error;
    }
  }
  async function ready(path, waitMs = 8000) {
    const deadline = Date.now() + waitMs;
    let result = await request(path);
    while (
      [result.state, result.source_status].includes("updating") &&
      Date.now() < deadline
    ) {
      await new Promise((resolve, reject) => {
        const done = () => {
          signal?.removeEventListener("abort", abort);
          resolve();
        };
        const abort = () => {
          clearTimeout(timer);
          reject(
            Object.assign(Error("股票資料查詢已取消"), {
              code: "STOCK_API_CANCELLED",
            }),
          );
        };
        const timer = setTimeout(done, Math.min(1000, deadline - Date.now()));
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      });
      result = await request(path);
    }
    return result;
  }
  const validDay = (value) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value || "") &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
  function range(args) {
    const start = args.start || scope.start,
      end = args.end || scope.end;
    if (
      !validDay(start) ||
      !validDay(end) ||
      start > end ||
      end > scope.end ||
      Date.parse(end) - Date.parse(start) > 3653 * 86400000
    )
      throw Error(
        "日期需為有效YYYY-MM-DD、起日不晚於截止且不超過本次查詢日期，最多十年",
      );
    return { start, end };
  }
  function page(rows, args, reverse = false) {
    const offset = args.offset || 0,
      limit = args.limit || 20;
    const first = reverse ? Math.max(0, rows.length - offset - limit) : offset;
    const last = reverse ? Math.max(0, rows.length - offset) : offset + limit;
    return {
      rows: rows.slice(first, last),
      total: rows.length,
      offset,
      limit,
      has_more: reverse ? first > 0 : last < rows.length,
    };
  }
  function bounded(value, args) {
    if (Array.isArray(value)) return page(value, args);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => key !== "revisions")
          .map(([key, item]) => [key, bounded(item, args)]),
      );
    return value;
  }
  const pathFor = (name, query) =>
    `/api/${name}/${scope.market}/${scope.symbol}?${new URLSearchParams(query)}`;
  async function technical(window) {
    const raw = await request(
      pathFor("chart", {
        ...window,
        resolution: "1d",
        price_basis: "raw",
      }),
    );
    if (!Array.isArray(raw.data))
      throw Object.assign(Error("技術圖表API回應結構不符"), {
        code: "STOCK_API_FORMAT",
      });
    // The chart API already warms indicators and annotates events. Reuse those
    // exact values instead of fetching another 500 days and recomputing EMAs.
    const rows = raw.data
      .filter(
        (row) =>
          row.is_final &&
          row.trade_date <= window.end &&
          (scope.mode !== "historical" ||
            Date.parse(row.end_time || row.timestamp) <=
              Date.parse(scope.as_of)),
      )
      .map((row) => ({ ...row, ...(row.analysis || {}) }));
    return {
      raw,
      rows,
      visible: rows.filter((row) => row.trade_date >= window.start),
    };
  }
  async function snapshot() {
    const [prices, current] = await Promise.allSettled([
      technical(range({})),
      scope.mode === "latest" ? quote() : Promise.resolve(null),
    ]);
    if (
      prices.status === "rejected" &&
      (current.status === "rejected" || !current.value)
    )
      throw Error("無可驗證行情可供試算");
    const visible = prices.status === "fulfilled" ? prices.value.visible : [];
    return {
      input: { bars: visible },
      report: {
        meta: { asset: isEtf(scope.symbol) ? "etf" : "stock" },
        evidence:
          current.status === "fulfilled" && current.value
            ? [{ id: "quote:snapshot", rows: [current.value] }]
            : [],
        metrics: visible.at(-1) || {},
      },
    };
  }
  async function quote() {
    if (scope.mode === "historical")
      throw Error("歷史模式沒有當時即時五檔快照，不以最新報價替代");
    return request(`/api/quote/${scope.market}/${scope.symbol}`);
  }
  async function call(name, args = {}, message = context.user_message || "") {
    const definition = sourceToolDefinitions.find((t) => t.name === name);
    if (!definition || !args || typeof args !== "object" || Array.isArray(args))
      throw Error("工具參數不符");
    for (const required of definition.inputSchema.required || [])
      if (!Object.hasOwn(args, required))
        throw Error("缺少工具參數：" + required);
    for (const [key, value] of Object.entries(args)) {
      const spec = definition.inputSchema.properties[key];
      if (
        !spec ||
        (spec.type === "string"
          ? typeof value !== "string" ||
            value.length > (spec.maxLength || 100) ||
            (spec.enum && !spec.enum.includes(value))
          : typeof value !== "number" ||
            !Number.isFinite(value) ||
            (spec.type === "integer" && !Number.isInteger(value)) ||
            value < spec.minimum ||
            value > spec.maximum)
      )
        throw Error("工具參數不符：" + key);
    }
    if ((args.cursor || args.source) && args.section !== "news")
      throw Error("cursor/source僅用於新聞");
    if (
      args.symbols !== undefined &&
      (args.section !== "peers" ||
        !args.symbols
          .split(",")
          .every((item) => /^(TWSE|TPEX):[A-Za-z0-9]{2,16}$/.test(item)))
    )
      throw Error("symbols僅用於同業，格式需為TWSE:2330,TWSE:2303");
    const newsDefault =
      args.section === "news" && !args.start
        ? {
            start: new Date(Date.parse(args.end || scope.end) - 6 * 86400000)
              .toISOString()
              .slice(0, 10),
          }
        : {};
    const window = range({ ...newsDefault, ...args }),
      queried_at = new Date().toISOString();
    let data,
      endpoint,
      category = args.section || name;
    try {
      const historicalUnsupported =
        scope.mode === "historical" &&
        !(
          name === "run_strategy_backtest" ||
          name === "get_valuation_bands" ||
          name === "calculate_trade_profit" ||
          (name === "get_stock_data" && args.section === "technical")
        );
      if (historicalUnsupported) {
        endpoint = "local:historical_unavailable";
        data = {
          status: "historical_unavailable",
          available: false,
          note: "來源API無法重建歷史當時已公布版本。可查歷史價格區間；不以最新財務、籌碼、新聞或基金組合冒充當時快照。",
        };
      } else if (name === "calculate_trade_profit") {
        endpoint = "local:calculate_trade_profit";
        category = "calculation";
        data = calculateTrade(args, await snapshot(), message);
      } else if (name === "get_stock_data" && args.section === "technical") {
        endpoint = "/api/chart";
        const result = await technical(window);
        data = {
          meta: { asset: isEtf(scope.symbol) ? "etf" : "stock" },
          bars: page(result.visible, args, true),
          metrics: result.visible.at(-1) || {},
          technical_event_version: EVENT_VERSION,
          price_basis: "raw",
          final_bars_only: true,
          source_state: result.raw.source_state,
          source_warning: result.raw.source_warning,
          received_at: result.raw.received_at,
          note: "現在查得的完成日K；不是當時接收快照。technical_state是持續狀態，signals是當根新事件，兩者不等於買賣指令。",
        };
      } else if (
        name === "get_stock_data" &&
        ["overview", "basic"].includes(args.section)
      ) {
        endpoint = pathFor("stock-data", { section: "basic", ...window });
        const result = await ready(endpoint, args.wait_ms);
        data = {
          ...result,
          data: bounded(result.data, args),
          note: "只取得基本資料，不預載全部財務與籌碼。其他面向按問題查詢；不含法人目標價或完整財務。",
        };
      } else if (
        name === "get_financial_history" ||
        (name === "get_stock_data" && args.section === "financial")
      ) {
        endpoint = pathFor("fundamentals", {});
        category = "financial";
        const finance = await ready(endpoint, args.wait_ms),
          metrics = finance.metrics || [];
        if (args.metric && args.page) throw Error("metric與page請擇一查詢");
        if (args.page) {
          const selectedPage = finance.catalog?.groups
            ?.flatMap((group) => group.pages)
            .find((page) => page.id === args.page);
          if (!selectedPage && finance.source_status !== "updating")
            throw Error("找不到財務細項，請先查目錄使用page id");
          const keys = selectedPage?.keys || [];
          const inside = (row) =>
            (!row.period || row.period <= window.end) &&
            (!args.start || !row.period || row.period >= window.start);
          const statement = selectedPage?.report
            ? finance.statements?.[selectedPage.report]
            : null;
          data = {
            page: selectedPage || null,
            metrics: metrics.filter(
              (metric) => keys.includes(metric.key) && inside(metric),
            ),
            history: Object.fromEntries(
              keys.map((key) => [
                key,
                page(
                  (finance.history?.[key] || []).filter(inside),
                  args,
                  args.order !== "asc",
                ),
              ]),
            ),
            statement: statement
              ? {
                  ...statement,
                  periods: (statement.periods || []).filter((period) =>
                    inside({ period }),
                  ),
                  rows: page(
                    (statement.rows || [])
                      .filter(
                        (row) =>
                          inside(row) &&
                          (!selectedPage.fields ||
                            selectedPage.fields.includes(row.key)),
                      )
                      .sort((a, b) =>
                        String(a.period).localeCompare(String(b.period)),
                      ),
                    args,
                    args.order !== "asc",
                  ),
                }
              : undefined,
            dividends:
              selectedPage?.kind === "dividends"
                ? page(
                    (finance.dividends || []).filter(
                      (row) =>
                        (!row.date || row.date <= window.end) &&
                        (!args.start || !row.date || row.date >= window.start),
                    ),
                    args,
                    args.order !== "asc",
                  )
                : undefined,
            coverage: finance.coverage,
            source_status: finance.source_status,
            note: finance.note,
          };
        } else if (args.metric) {
          const metric = metrics.find((m) => (m.key || m.id) === args.metric);
          if (!metric && finance.source_status === "updating") {
            data = {
              source_status: "updating",
              requested_metric: args.metric,
              history: page([], args),
              coverage: finance.coverage,
              note: "來源仍在載入，此時尚無指標不代表不存在；可稍後重查，不重設成無資料。",
            };
          } else {
            if (!metric)
              throw Error("找不到指標，請先查財務指標目錄，使用回傳的key");
            const rows = (finance.history?.[args.metric] || []).filter(
              (row) =>
                (!row.period || row.period <= window.end) &&
                (!args.start || !row.period || row.period >= window.start),
            );
            const selected = rows.at(-1);
            data = {
              metric:
                metric.period > window.end
                  ? {
                      ...metric,
                      period: selected?.period || null,
                      value: selected?.value ?? null,
                      comparison: null,
                      assessment: null,
                    }
                  : metric,
              history: page(rows, args, args.order !== "asc"),
              coverage: finance.coverage,
              source_status: finance.source_status,
              note: finance.note,
            };
          }
        } else
          data = {
            catalogue: metrics.map((m) => ({
              key: m.key || m.id,
              label: m.label,
              date: m.date || m.period,
              value: (m.date || m.period) > window.end ? null : m.value,
              unit: m.unit,
              availability: m.availability,
            })),
            catalog: window.end === scope.end ? finance.catalog : undefined,
            coverage: finance.coverage,
            source_status: finance.source_status,
            note: finance.note,
          };
      } else if (
        name === "get_chip_detail" ||
        (name === "get_stock_data" && args.section === "chips")
      ) {
        endpoint = pathFor("equity", window);
        category = "chips";
        const equity = await ready(endpoint, args.wait_ms),
          tabs = equity.workspace?.tabs || equity.workspace || {};
        const entries = Array.isArray(tabs)
          ? tabs.map((tab) => [tab.id || tab.key, tab])
          : Object.entries(tabs);
        if (args.dataset) {
          const requested = Object.hasOwn(chipPages, args.dataset)
            ? args.dataset
            : Object.keys(chipPages).find((key) =>
                chipPages[key].includes(args.dataset),
              ) || args.dataset;
          const entry = entries.find(([id]) => id === requested);
          if (!entry) throw Error("找不到籌碼子頁，請先查子頁目錄");
          data = {
            dataset: Array.isArray(entry[1])
              ? page(
                  [...entry[1]].sort((a, b) =>
                    String(a.date || a.period || "").localeCompare(
                      String(b.date || b.period || ""),
                    ),
                  ),
                  args,
                  args.order !== "asc",
                )
              : bounded(entry[1], args),
            dataset_id: requested,
            dataset_status:
              equity.coverage?.find(
                (c) => c.dataset === chipPages[requested]?.[1],
              )?.status || equity.source_status,
            label: chipPages[requested]?.[0] || requested,
            definition: equity.workspace?.definitions?.[requested],
            coverage: equity.coverage,
            source_status: equity.source_status,
            note: equity.note,
            unit: "股",
          };
        } else
          data = {
            catalogue: entries
              .filter(([id]) => !["definitions", "prices"].includes(id))
              .map(([id, tab]) => ({
                id,
                label: chipPages[id]?.[0] || tab.label || tab.title || id,
                source_dataset: chipPages[id]?.[1],
                status:
                  equity.coverage?.find((c) => c.dataset === chipPages[id]?.[1])
                    ?.status || tab.status,
                rows: Array.isArray(tab) ? tab.length : undefined,
              })),
            metrics: equity.metrics,
            definitions: equity.workspace?.definitions,
            coverage: equity.coverage,
            source_status: equity.source_status,
            unit: "股",
            note: equity.note,
          };
      } else if (name === "get_fund_data" || name === "get_valuation_bands") {
        endpoint = pathFor(
          name === "get_fund_data" ? "fund-data" : "valuation-bands",
          {
            ...window,
            ...(args.section
              ? { section: args.section }
              : { field: args.field }),
          },
        );
        data = bounded(await request(endpoint), args);
      } else if (name === "run_strategy_backtest") {
        endpoint = "/api/strategy/backtest";
        data = bounded(
          await request(endpoint, {
            market: scope.market,
            symbol: scope.symbol,
            ...window,
            resolution: "1d",
            price_basis: "raw",
            fee_bps: args.fee_bps,
            slippage_bps: args.slippage_bps,
            sell_tax_bps: args.sell_tax_bps,
          }),
          args,
        );
      } else if (args.section === "peers") {
        endpoint = pathFor("peers", {
          reference: window.end,
          view_mode: "latest",
          alignment: "common",
          ...(args.symbols ? { symbols: args.symbols } : {}),
        });
        // Peers are built from shared source memory, which other tool calls can
        // populate during this turn. Do not freeze a pre-load empty comparison.
        cache.delete(endpoint + "null");
        data = bounded(await request(endpoint), args);
      } else if (args.section === "news") {
        if (Date.parse(window.end) - Date.parse(window.start) > 30 * 86400000)
          throw Error("新聞一次最多31日，請明傳start/end縮小範圍");
        if (
          args.cursor &&
          (!validDay(args.cursor) ||
            args.cursor < window.start ||
            args.cursor > window.end)
        )
          throw Error("新聞cursor需為區間內日期");
        endpoint = pathFor("media", {
          ...window,
          ...(args.cursor ? { cursor: args.cursor } : {}),
          ...(args.source ? { source: args.source } : {}),
        });
        data = bounded(await request(endpoint), args);
      } else if (args.section === "market") {
        endpoint = "/api/market/board";
        data = await request(endpoint);
      } else {
        endpoint = "local:not_supported";
        data = {
          status: "not_supported",
          note: "不使用舊固定策略價位作整體建議，請查technical後依實際訊號分析；回放請用run_strategy_backtest。",
        };
      }
      const id =
        "tool:" +
        createHash("sha256")
          .update(JSON.stringify({ scope, name, args, data }))
          .digest("hex")
          .slice(0, 20);
      const result = {
        evidence_id: id,
        evidence: [],
        market: scope.market,
        symbol: scope.symbol,
        mode: scope.mode,
        as_of: scope.as_of,
        ...window,
        queried_at,
        endpoint,
        database_used: false,
        storage: "memory",
        point_in_time: false,
        data,
      };
      await onCall({
        name,
        arguments: args,
        status: "completed",
        category,
        ...result,
      });
      return result;
    } catch (error) {
      await onCall({
        name,
        arguments: args,
        status: "failed",
        category,
        market: scope.market,
        symbol: scope.symbol,
        queried_at,
        error: error.message,
        error_code: error.code || "TOOL_ERROR",
      });
      error.tool_audited = true;
      throw error;
    }
  }
  return { call, snapshot, quote };
}
