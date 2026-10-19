import { fetchJSON, fail } from "./lib.js";

export const SCREEN_FIELDS = [
  "close",
  "volume_shares",
  "turnover",
  "change_percent",
];
const sources = {
  TWSE: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
  TPEX: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
};
const number = (v) => {
  if (v == null || !String(v).trim()) return null;
  const n = Number(String(v).replaceAll(",", "").trim());
  return Number.isFinite(n) ? n : null;
};
export function normalizeMarketRows(market, input) {
  if (!Array.isArray(input) || !input.length)
    throw Error("官方價量資料為空或格式不符");
  const result = new Map();
  for (const r of input) {
    const symbol = String(r.Code ?? r.SecuritiesCompanyCode ?? "").trim();
    const asset =
      /^\d{4}$/.test(symbol) && !symbol.startsWith("00")
        ? "stock"
        : /^00[A-Z0-9]{3,4}$/.test(symbol)
          ? "etf"
          : null;
    if (!asset) continue; // Exclude warrants, ETNs and unclassified securities.
    const date = String(r.Date ?? "")
      .replaceAll("/", "")
      .trim();
    if (!/^\d{7,8}$/.test(date)) continue;
    const year = Number(date.slice(0, -4)) + (date.length === 7 ? 1911 : 0);
    const trade_date = `${year}-${date.slice(-4, -2)}-${date.slice(-2)}`;
    if (!Number.isFinite(Date.parse(trade_date + "T00:00:00Z"))) continue;
    const close = number(r.ClosingPrice ?? r.Close),
      change = number(r.Change);
    const previous = close != null && change != null ? close - change : null;
    const row = {
      market,
      symbol,
      name: String(r.Name ?? r.CompanyName ?? "").trim(),
      asset,
      trade_date,
      close,
      change,
      change_percent: previous > 0 ? (change / previous) * 100 : null,
      volume_shares: number(r.TradeVolume ?? r.TradingShares),
      turnover: number(r.TradeValue ?? r.TransactionAmount),
    };
    if (!result.has(symbol) || result.get(symbol).trade_date < trade_date)
      result.set(symbol, row);
  }
  if (!result.size) throw Error("官方資料沒有可辨識的股票或ETF");
  return [...result.values()];
}
export function screenOptions(input = {}) {
  const allowed = new Set([
    "market",
    "asset",
    "sort_by",
    "order",
    "limit",
    "offset",
    "min_price",
    "max_price",
    "min_volume_shares",
    "min_turnover",
    "min_change_percent",
    "max_change_percent",
  ]);
  if (Object.keys(input).some((k) => !allowed.has(k)))
    fail("選股含不支援條件，不可忽略後繼續篩選");
  const q = {
    market: "ALL",
    asset: "stock",
    sort_by: "volume_shares",
    order: "desc",
    limit: 20,
    offset: 0,
    ...input,
  };
  if (
    !["ALL", "TWSE", "TPEX"].includes(q.market) ||
    !["stock", "etf", "all"].includes(q.asset) ||
    !SCREEN_FIELDS.includes(q.sort_by) ||
    !["asc", "desc"].includes(q.order)
  )
    fail("選股市場、商品或排序條件不符");
  for (const key of [
    "limit",
    "offset",
    "min_price",
    "max_price",
    "min_volume_shares",
    "min_turnover",
    "min_change_percent",
    "max_change_percent",
  ]) {
    if (q[key] == null) continue;
    if (!String(q[key]).trim() || typeof q[key] === "boolean")
      fail("選股數值條件不符");
    q[key] = Number(q[key]);
    if (
      !Number.isFinite(q[key]) ||
      Math.abs(q[key]) > 1e15 ||
      (!key.includes("change") && q[key] < 0)
    )
      fail("選股數值條件不符");
  }
  if (
    !Number.isInteger(q.limit) ||
    q.limit < 1 ||
    q.limit > 50 ||
    !Number.isInteger(q.offset) ||
    q.offset > 10000
  )
    fail("選股分頁範圍不符");
  if (
    (q.min_price != null && q.max_price != null && q.min_price > q.max_price) ||
    (q.min_change_percent != null &&
      q.max_change_percent != null &&
      q.min_change_percent > q.max_change_percent)
  )
    fail("選股下限不能大於上限");
  return q;
}
export function filterMarketRows(rows, q) {
  return rows
    .filter(
      (r) =>
        r.close > 0 &&
        (q.asset === "all" || r.asset === q.asset) &&
        [
          ["close", q.min_price, q.max_price],
          ["volume_shares", q.min_volume_shares],
          ["turnover", q.min_turnover],
          ["change_percent", q.min_change_percent, q.max_change_percent],
        ].every(
          ([key, min, max]) =>
            (min == null || (r[key] != null && r[key] >= min)) &&
            (max == null || (r[key] != null && r[key] <= max)),
        ) &&
        r[q.sort_by] != null,
    )
    .sort(
      (a, b) =>
        (q.order === "asc" ? 1 : -1) * (a[q.sort_by] - b[q.sort_by]) ||
        a.symbol.localeCompare(b.symbol),
    );
}
export function createMarketScreen({
  load = async (url) => {
    try {
      return await fetchJSON(url, 18000);
    } catch {
      return fetchJSON(url, 18000);
    }
  },
  clock = Date.now,
} = {}) {
  const cache = new Map(),
    pending = new Map();
  async function source(market) {
    let item = cache.get(market);
    if (!item || clock() - item.at > 300000) {
      if (!pending.has(market))
        pending.set(
          market,
          (async () => {
            const rows = normalizeMarketRows(
              market,
              await load(sources[market]),
            );
            const fresh = { at: clock(), rows };
            cache.set(market, fresh);
            return fresh;
          })().finally(() => pending.delete(market)),
        );
      item = await pending.get(market);
    }
    return item;
  }
  return async (input = {}) => {
    const q = screenOptions(input);
    const markets = q.market === "ALL" ? ["TWSE", "TPEX"] : [q.market];
    const loaded = await Promise.all(
      markets.map(async (market) => {
        try {
          return { market, ...(await source(market)) };
        } catch {
          return { market, error: "官方價量來源取得失敗，不使用舊快取或補零" };
        }
      }),
    );
    const available = loaded.filter((s) => !s.error);
    if (!available.length) fail("全市場價量來源暫時無法取得", 502);
    const dates = [
      ...new Set(available.flatMap((s) => s.rows.map((r) => r.trade_date))),
    ].sort();
    const groups = dates.map((trade_date) => {
      const universe = available
        .flatMap((s) => s.rows)
        .filter(
          (r) =>
            r.trade_date === trade_date &&
            (q.asset === "all" || r.asset === q.asset),
        );
      const matched = filterMarketRows(universe, q);
      return {
        trade_date,
        markets: [...new Set(universe.map((r) => r.market))],
        universe_count: universe.length,
        matched_count: matched.length,
        rows: matched.slice(q.offset, q.offset + q.limit),
        has_more: matched.length > q.offset + q.limit,
      };
    });
    return {
      kind: "official_daily_screen",
      realtime: false,
      filters: q,
      complete: available.length === markets.length && dates.length === 1,
      groups,
      sources: loaded.map((s) => ({
        market: s.market,
        url: sources[s.market],
        available: !s.error,
        received_at: s.at != null ? new Date(s.at).toISOString() : null,
        trade_dates: s.rows
          ? [...new Set(s.rows.map((r) => r.trade_date))]
          : [],
        error: s.error,
      })),
      note: "官方盤後日價量，非盤中即時排行；以來源日期為準。不同日期分組排序，不可稱為同日全市場排行。成交量為股、成交金額為元、漲跌幅為%。僅篩選價量，不代表財務或技術條件已成立；不含權證及ETN。",
    };
  };
}
export const marketScreen = createMarketScreen();
