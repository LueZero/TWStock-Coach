// JSON schemas serve both request validation and the OpenAPI contract.
const text = { type: "string" },
  date = {
    type: "string",
    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    description: "交易／財務日期，YYYY-MM-DD",
  },
  stamp = {
    type: "string",
    pattern: "(Z|[+-]\\d{2}:\\d{2})$",
    description: "具明確時區的ISO時間",
  },
  decimal = {
    anyOf: [
      { type: "number" },
      {
        type: "string",
        pattern: "^[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?$",
      },
    ],
  },
  nullable = (s) => ({ anyOf: [s, { type: "null" }] }),
  enumOf = (...values) => ({ type: "string", enum: values }),
  object = (properties, required = []) => ({
    type: "object",
    properties,
    required,
  }),
  pair = {
    market: enumOf("TWSE", "TPEX"),
    symbol: { type: "string", pattern: "^[A-Za-z0-9]{2,16}$" },
  },
  range = { start: date, end: date },
  basis = enumOf("raw", "adjusted"),
  resolution = enumOf(
    "1m",
    "5m",
    "15m",
    "30m",
    "60m",
    "120m",
    "1d",
    "1w",
    "1mo",
  );
const strategy = object(
  {
    ...pair,
    ...range,
    resolution,
    price_basis: basis,
    selected_timestamp: nullable(stamp),
    cost: nullable(decimal),
    shares: { type: "integer", minimum: 0, maximum: 1e8 },
    initial_stop: nullable(decimal),
    peak: nullable(decimal),
    risk_budget: decimal,
    fee_bps: decimal,
    slippage_bps: decimal,
    sell_tax_bps: decimal,
  },
  ["market", "symbol", "start", "end"],
);
const bar = object(
  {
    ...pair,
    session: enumOf(
      "regular",
      "intraday_odd",
      "afterhours_odd",
      "daily_aggregate",
    ),
    timeframe: enumOf("1d", "1m"),
    price_basis: basis,
    timestamp: stamp,
    trade_date: date,
    open: decimal,
    high: decimal,
    low: decimal,
    close: decimal,
    volume: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    source_volume_unit: enumOf("shares", "lots"),
    source: { type: "string", minLength: 1, maxLength: 64 },
    source_time: stamp,
    is_final: { type: "boolean" },
    payload: { type: "object" },
  },
  [
    "market",
    "symbol",
    "session",
    "timeframe",
    "timestamp",
    "trade_date",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "source",
    "source_time",
    "is_final",
  ],
);
export const protectedPaths = new Set(["/api/ingest", "/api/equity/import"]);
export function contract(path, method) {
  const schema = { summary: path, tags: [path.split("/")[2] ?? "platform"] };
  if (path.includes(":market"))
    schema.params = object(pair, ["market", "symbol"]);
  const queries = {
    "/api/market/chips": object({ date }),
    "/api/media/:market/:symbol": object({ date }),
    "/api/market/board/chart": object({
      product: enumOf("index", "day", "night"),
      mode: enumOf("intraday", "history"),
      symbol: text,
      contract: text,
      ...range,
    }),
    "/api/market/range": object(
      { end: date, sessions: { type: "string", pattern: "^\\d+$" } },
      ["end"],
    ),
    "/api/search": object({ q: { type: "string", maxLength: 40 } }),
    "/api/intraday/:market/:symbol": object({ day: date }),
    "/api/chart/:market/:symbol": object(
      {
        ...range,
        resolution,
        price_basis: basis,
        session: enumOf("regular", "intraday_odd", "afterhours_odd"),
        ma_periods: text,
      },
      ["start", "end"],
    ),
    "/api/fundamentals/:market/:symbol": object({
      as_of: stamp,
      include_raw: enumOf("true", "false"),
    }),
    "/api/equity/:market/:symbol": object({ ...range, as_of: stamp }, [
      "start",
      "end",
    ]),
    "/api/peers/:market/:symbol": object(
      {
        reference: date,
        view_mode: enumOf("latest", "historical"),
        alignment: enumOf("common", "latest"),
        symbols: { type: "string", maxLength: 10000 },
      },
      ["reference"],
    ),
    "/api/bars/:market/:symbol": object({
      ...range,
      timeframe: enumOf("1d", "1m"),
      session: enumOf(
        "regular",
        "intraday_odd",
        "afterhours_odd",
        "daily_aggregate",
      ),
      price_basis: basis,
      limit: { type: "string", pattern: "^\\d+$" },
    }),
  };
  if (method === "GET" && queries[path]) schema.querystring = queries[path];
  if (path === "/api/jobs/:id")
    schema.params = object({ id: { type: "string", pattern: "^\\d+$" } }, [
      "id",
    ]);
  const bodies = {
    "/api/calculator": object(
      {
        trade_date: date,
        mode: enumOf("buy", "sell", "roundtrip", "day_long", "day_short"),
        asset: enumOf("stock", "etf", "bond_etf", "custom"),
        buy_price: nullable(decimal),
        sell_price: nullable(decimal),
        close_change_percent: nullable(decimal),
        close_tick_change: nullable({
          type: "integer",
          minimum: -200,
          maximum: 200,
        }),
        quantity: { type: "integer", minimum: 1, maximum: 1e8 },
        unit: enumOf("shares", "lots"),
        fee_percent: decimal,
        discount: decimal,
        minimum_fee: decimal,
        tax_percent: nullable(decimal),
        extra_cost: decimal,
        fee_rounding: enumOf("floor", "nearest", "ceil"),
        tax_rounding: enumOf("floor", "nearest", "ceil"),
        scenario_mode: enumOf("percent", "ticks"),
        scenario_tick_step: { type: "integer" },
        scenario_steps: { type: "integer" },
        scenario_up_step: decimal,
        scenario_down_step: decimal,
      },
      ["trade_date"],
    ),
    "/api/history/load": object(
      {
        ...pair,
        ...range,
        price_basis: basis,
        timeframe: enumOf("1d", "1m"),
        warmup_days: { type: "integer", minimum: 420, maximum: 8000 },
      },
      ["market", "symbol", "start", "end"],
    ),
    "/api/fundamentals/load": object(pair, ["market", "symbol"]),
    "/api/equity/load": object({ ...pair, end: date }, [
      "market",
      "symbol",
      "end",
    ]),
    "/api/equity/import": object(
      {
        ...pair,
        dataset: enumOf("AnalystTargetReport", "FundHoldingsReport"),
        source: { type: "string", minLength: 1, maxLength: 64 },
        rows: {
          type: "array",
          minItems: 1,
          maxItems: 10000,
          items: { type: "object" },
        },
      },
      ["market", "symbol", "dataset", "source", "rows"],
    ),
    "/api/ingest": { type: "array", minItems: 1, maxItems: 5000, items: bar },
    "/api/strategy/analyze": strategy,
    "/api/strategy/backtest": strategy,
  };
  if (method === "POST") schema.body = bodies[path];
  if (protectedPaths.has(path)) schema.security = [{ ingestKey: [] }];
  if (path === "/" || path === "/openapi.json") schema.hide = true;
  return schema;
}
