import { createHash } from "node:crypto";
import { calculate } from "../api/indicators.js";
import {
  annotateTechnicalRows,
  EVENT_VERSION,
} from "../api/technical-events.js";
import { calculateTrade } from "./trade-math.js";
import { toolDefinitions } from "./tools.js";
import { isEtf } from "../api/data-availability.js";

const date = { type: "string", maxLength: 10 };
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
          : { start: date, end: date }),
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
    if (!cache.has(key))
      cache.set(
        key,
        (async () => {
          const response = await fetcher(new URL(path, base), {
            method: body ? "POST" : "GET",
            ...(body
              ? {
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(body),
                }
              : {}),
            redirect: "error",
            signal: AbortSignal.any([
              AbortSignal.timeout(45000),
              ...(signal ? [signal] : []),
            ]),
          });
          if (!response.ok)
            throw Error(
              `來源API查詢失敗（HTTP ${response.status}）；請核對區間、權限或稍後重試`,
            );
          const value = await response.json();
          if (JSON.stringify(value).length > 4000000)
            throw Error("來源回應過大，請縮小查詢範圍");
          return value;
        })(),
      );
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
    const warmup = new Date(Date.parse(window.start) - 500 * 86400000)
      .toISOString()
      .slice(0, 10);
    const raw = await request(
      pathFor("chart", {
        ...window,
        start: warmup,
        resolution: "1d",
        price_basis: "raw",
      }),
    );
    const rows = annotateTechnicalRows(
      calculate(
        (raw.data || []).filter(
          (row) =>
            row.is_final &&
            row.trade_date <= window.end &&
            (scope.mode !== "historical" ||
              Date.parse(row.end_time || row.timestamp) <=
                Date.parse(scope.as_of)),
        ),
      ),
    );
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
        const result = await request(endpoint);
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
        const finance = await request(endpoint),
          metrics = finance.metrics || [];
        if (args.metric) {
          const metric = metrics.find((m) => (m.key || m.id) === args.metric);
          if (!metric)
            throw Error("找不到指標，請先查財務指標目錄；載入中請稍後重查");
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
            history: page(rows, args),
            coverage: finance.coverage,
            source_status: finance.source_status,
            note: finance.note,
          };
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
        const equity = await request(endpoint),
          tabs = equity.workspace?.tabs || equity.workspace || {};
        const entries = Array.isArray(tabs)
          ? tabs.map((tab) => [tab.id || tab.key, tab])
          : Object.entries(tabs);
        if (args.dataset) {
          const entry = entries.find(([id]) => id === args.dataset);
          if (!entry) throw Error("找不到籌碼子頁，請先查子頁目錄");
          data = {
            dataset: bounded(entry[1], args),
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
                label: tab.label || tab.title || id,
                status: tab.status,
                rows: Array.isArray(tab) ? tab.length : undefined,
              })),
            summary: equity.summary,
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
      });
      throw error;
    }
  }
  return { call, snapshot, quote };
}
