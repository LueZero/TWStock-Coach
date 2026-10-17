import {
  num,
  validDate,
  stock,
  taipeiDay,
  now,
  fail,
  fetchJSON,
  serialQueue,
} from "./lib.js";
import { rows, transaction } from "./db.js";
import { FinMind } from "./providers.js";
import { saveQuote } from "./quote-store.js";
const number = (v) => {
    const n = num(v);
    return n != null && n >= 0 ? n : null;
  },
  quoteCache = new Map(),
  serialize = serialQueue();
let catalogAt = 0,
  catalogError = 0;
export function levels(prices, volumes) {
  const p = String(prices ?? "").split("_"),
    v = String(volumes ?? "").split("_");
  return Array.from({ length: 5 }, (_, i) => {
    const price = number(p[i]),
      lots = number(v[i]);
    return {
      level: i + 1,
      price: price > 0 ? price : null,
      volume_shares:
        lots != null && Number.isSafeInteger(lots * 1000) ? lots * 1000 : null,
    };
  });
}
export function parseQuote(item, market, symbol, receivedAt = now()) {
  if (item.c !== symbol || item.ex !== (market === "TWSE" ? "tse" : "otc"))
    fail("行情來源回傳不同的股票或市場");
  const d = String(item.d),
    day = validDate(d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8)),
    book = new Date(Number(item.tlong)).toISOString();
  if (day > taipeiDay() || taipeiDay(book) !== day)
    fail("行情來源時間與交易日期不一致");
  let last = number(item.z),
    clock = item.t;
  const trade = item.trade && typeof item.trade === "object" ? item.trade : {};
  if (!last && number(trade.z)) {
    last = number(trade.z);
    clock = trade.t;
  }
  const tradeTime =
      /^\d{2}:\d{2}:\d{2}$/.test(clock ?? "") &&
      Number.isFinite(Date.parse(day + "T" + clock + "+08:00"))
        ? new Date(day + "T" + clock + "+08:00").toISOString()
        : null,
    previous = number(item.y),
    lots = number(item.v);
  last = last > 0 ? last : null;
  return {
    market,
    symbol,
    name: item.n ?? symbol,
    trade_date: day,
    source_time: book,
    trade_time: tradeTime,
    received_at: receivedAt,
    source: "twse_mis",
    source_label: "證交所公開行情快照",
    last_price: last,
    previous_close: previous,
    change: last != null && previous ? last - previous : null,
    change_percent:
      last != null && previous ? (last / previous - 1) * 100 : null,
    open: number(item.o),
    high: number(item.h),
    low: number(item.l),
    limit_up: number(item.u),
    limit_down: number(item.w),
    volume_shares:
      lots != null && Number.isSafeInteger(lots * 1000) ? lots * 1000 : null,
    bids: levels(item.b, item.g),
    asks: levels(item.a, item.f),
    session: "regular",
    snapshot_only: true,
    raw_payload: item,
  };
}
export function quoteState(data, stamp = new Date()) {
  const { raw_payload, ...result } = data,
    local = new Date(new Date(stamp).getTime() + 8 * 3600000),
    age = Math.max(0, (new Date(stamp) - new Date(data.source_time)) / 1000),
    during =
      local.getUTCHours() * 60 + local.getUTCMinutes() >= 540 &&
      local.getUTCHours() * 60 + local.getUTCMinutes() < 810,
    state =
      data.trade_date < taipeiDay(stamp)
        ? "previous_session"
        : during && age > 120
          ? "delayed"
          : during
            ? "snapshot"
            : "after_close";
  return {
    ...result,
    state,
    state_label: {
      previous_session: "最近交易日資料（不是今日報價）",
      delayed: "行情已延遲",
      snapshot: "盤中公開快照",
      after_close: "盤後公開快照",
    }[state],
    age_seconds: age,
  };
}
export async function getQuote(market, symbol) {
  stock(market, symbol);
  return serialize(async () => {
    const k = market + ":" + symbol,
      cached = quoteCache.get(k);
    if (cached && Date.now() - cached.at < 10000)
      return quoteState(cached.data);
    try {
      const body = await fetchJSON(
        `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${market === "TWSE" ? "tse" : "otc"}_${symbol}.tw&json=1&delay=0`,
        12000,
        {
          headers: {
            "User-Agent": "StockIntelligentAssistant/1.0 personal-dashboard",
          },
        },
      );
      if (body.rtcode !== "0000" || !body.msgArray?.length)
        throw Error("No quote");
      const data = parseQuote(body.msgArray[0], market, symbol);
      await transaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(78241002)");
        await saveQuote(client, data);
      });
      quoteCache.set(k, { at: Date.now(), data });
      if (quoteCache.size > 200)
        quoteCache.delete(
          [...quoteCache.entries()].sort((a, b) => a[1].at - b[1].at)[0][0],
        );
      return quoteState(data);
    } catch {
      if (cached)
        return {
          ...quoteState(cached.data),
          state: "unavailable",
          state_label: "來源暫時無法更新，顯示上次快照",
        };
      const saved = (
        await rows(
          "SELECT data FROM quote_snapshots WHERE market=$1 AND symbol=$2 ORDER BY source_time DESC LIMIT 1",
          [market, symbol],
        )
      )[0];
      if (saved)
        return {
          ...quoteState(saved.data),
          state: "unavailable",
          state_label: "來源暫時無法更新，顯示上次快照",
        };
      fail("公開行情目前無資料或無法連線；請確認市場與代號，稍後再試", 503);
    }
  });
}
const catalogQueue = serialQueue();
export async function refreshCatalog() {
  return catalogQueue(async () => {
    if (Date.now() - catalogAt < 86400000 || Date.now() - catalogError < 60000)
      return;
    try {
      const items = await new FinMind().get("TaiwanStockInfo"),
        latest = {};
      for (const i of items)
        if (
          /^[A-Za-z0-9]{2,16}$/.test(i.stock_id ?? "") &&
          (!latest[i.stock_id] ||
            (i.date ?? "") > (latest[i.stock_id].date ?? ""))
        )
          latest[i.stock_id] = i;
      await transaction(async (client) => {
        for (const [symbol, i] of Object.entries(latest))
          if (["twse", "tpex"].includes(i.type))
            await client.query(
              "INSERT INTO instruments(market,symbol,name,industry,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(market,symbol) DO UPDATE SET name=EXCLUDED.name,industry=EXCLUDED.industry,updated_at=EXCLUDED.updated_at",
              [
                i.type === "twse" ? "TWSE" : "TPEX",
                symbol,
                i.stock_name || symbol,
                i.industry_category || "",
                now(),
              ],
            );
      });
      catalogAt = Date.now();
    } catch {
      catalogError = Date.now();
    }
  });
}
export async function search(q) {
  await refreshCatalog();
  const all = await rows(
    "SELECT market,symbol,name,industry FROM instruments ORDER BY symbol",
  );
  return all
    .filter(
      (i) =>
        i.symbol.toLowerCase().includes(q.toLowerCase()) || i.name.includes(q),
    )
    .sort(
      (a, b) =>
        Number(a.symbol !== q) - Number(b.symbol !== q) ||
        Number(!a.symbol.startsWith(q)) - Number(!b.symbol.startsWith(q)) ||
        a.symbol.localeCompare(b.symbol),
    )
    .slice(0, 15)
    .map((i) => ({
      ...i,
      market_label: i.market === "TWSE" ? "上市" : "上櫃",
    }));
}
