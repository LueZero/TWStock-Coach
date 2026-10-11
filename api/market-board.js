import {
  fetchJSON,
  num,
  validDate,
  taipeiDay,
  digest,
  addDays,
} from "./lib.js";
import { rows, query } from "./db.js";
import { FinMind } from "./providers.js";

const cache = new Map();
const pending = new Map();
const numeric = (v) => {
  if (v == null || String(v).trim() === "") return null;
  return num(String(v).replaceAll(",", "").replace("%", ""));
};
export function contractMonth(symbol, date) {
  const match = /^TXF([A-L])(\d)-[FM]$/.exec(symbol);
  if (!match || !/^\d{8}$/.test(date)) return null;
  const year = Number(date.slice(0, 4));
  let expiryYear = Math.floor(year / 10) * 10 + Number(match[2]);
  if (expiryYear < year - 1) expiryYear += 10;
  return `${expiryYear}${String(match[1].charCodeAt(0) - 64).padStart(2, "0")}`;
}
export function parseBoardQuote(item, chart, session, receivedAt) {
  const q = chart?.Quote || item;
  const price = numeric(q.CLastPrice),
    reference = numeric(q.CRefPrice);
  const day = /^\d{8}$/.test(q.CDate || "")
    ? validDate(
        `${q.CDate.slice(0, 4)}-${q.CDate.slice(4, 6)}-${q.CDate.slice(6)}`,
      )
    : null;
  const isIndex = item.SymbolID === "TXF-S";
  const lastClock = /^\d{6}$/.test(item.CTime || "") ? item.CTime : null;
  const data = (chart?.Ticks || [])
    .flatMap((row) => {
      if (!/^\d{6}$/.test(row[0])) return [];
      const [open, high, low, close, volume] = row.slice(1).map(numeric);
      if (
        [open, high, low, close].some((v) => !(v > 0)) ||
        high < Math.max(open, close) ||
        low > Math.min(open, close)
      )
        return [];
      const clock = `${row[0].slice(0, 2)}:${row[0].slice(2, 4)}`;
      const minute =
        Number(row[0].slice(0, 2)) * 60 + Number(row[0].slice(2, 4));
      return [
        {
          label: clock,
          session_minute:
            session === "night" && minute < 900 ? minute + 1440 : minute,
          session_start_minute: isIndex ? 540 : session === "night" ? 900 : 525,
          open,
          high,
          low,
          close,
          volume: isIndex ? null : volume,
          is_final:
            chart.Info?.Status === "4" ||
            (lastClock != null &&
              row[0].slice(0, 4) < lastClock.slice(0, 4) &&
              !(
                session === "night" &&
                minute >= 900 &&
                Number(lastClock.slice(0, 2)) < 15
              )) ||
            (session === "night" &&
              minute >= 900 &&
              lastClock != null &&
              Number(lastClock.slice(0, 2)) < 15),
        },
      ];
    })
    .sort((a, b) => a.session_minute - b.session_minute);
  return {
    symbol: item.SymbolID,
    name: isIndex
      ? "加權指數"
      : session === "night"
        ? "台指期夜盤"
        : "台指期日盤",
    contract_month: contractMonth(item.SymbolID, q.CDate),
    session,
    source: "taifex_mis",
    source_label: "期交所公開行情快照",
    source_date: day,
    source_clock: lastClock
      ? `${lastClock.slice(0, 2)}:${lastClock.slice(2, 4)}:${lastClock.slice(4)}`
      : null,
    received_at: receivedAt,
    status:
      item.Status === "TC" || chart?.Info?.Status === "4"
        ? "closed"
        : "snapshot",
    last_price: price > 0 ? price : null,
    reference_price: reference > 0 ? reference : null,
    change: price > 0 && reference > 0 ? price - reference : null,
    change_percent:
      price > 0 && reference > 0 ? (price / reference - 1) * 100 : null,
    open: numeric(q.COpenPrice),
    high: numeric(q.CHighPrice),
    low: numeric(q.CLowPrice),
    volume: isIndex ? null : numeric(q.CTotalVolume),
    volume_unit: isIndex ? null : "口",
    open_interest: numeric(q.OpenInterest),
    bids: Array.from({ length: 5 }, (_, i) => ({
      price: numeric(q[`CBidPrice${i + 1}`]),
      volume: numeric(q[`CBidSize${i + 1}`]),
    })),
    asks: Array.from({ length: 5 }, (_, i) => ({
      price: numeric(q[`CAskPrice${i + 1}`]),
      volume: numeric(q[`CAskSize${i + 1}`]),
    })),
    data,
    raw_payload: { quote: item, chart: chart || null },
    note: isIndex
      ? "指數沒有委託五檔與成交口數。"
      : "漲跌以本盤官方參考價計算；不同月份不拼接。夜盤保留官方盤別日期，圖表按15:00至翌日05:00排列，不冒充交易日歸屬。",
  };
}
export async function saved(key, ttl, load) {
  if (cache.has(key) && Date.now() - cache.get(key).at < ttl)
    return cache.get(key).value;
  if (pending.has(key)) return pending.get(key);
  const task = (async () => {
    try {
      const value = await load();
      const identity = { ...value };
      delete identity.received_at;
      if (identity.products)
        identity.products = identity.products.map(({ received_at, ...p }) => p);
      await query(
        "INSERT INTO market_board_snapshots(source_key,digest,received_at,last_seen_at,data) VALUES($1,$2,now(),now(),$3) ON CONFLICT(source_key,digest) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at",
        [key, digest(identity), JSON.stringify(value)],
      );
      cache.set(key, { at: Date.now(), value });
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      return value;
    } catch (error) {
      const old =
        cache.get(key)?.value ||
        (
          await rows(
            "SELECT data FROM market_board_snapshots WHERE source_key=$1 ORDER BY last_seen_at DESC,id DESC LIMIT 1",
            [key],
          )
        )[0]?.data;
      if (old)
        return {
          ...old,
          stale: true,
          warning: "來源暫時無法更新，顯示先前接收資料。",
        };
      throw error;
    }
  })().finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}
const post = (endpoint, body) =>
  fetchJSON("https://mis.taifex.com.tw/futures/api/" + endpoint, {
    timeout: 12000,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((body) => {
    if (body.RtCode !== "0" || !body.RtData)
      throw Error("期交所行情暫時無法取得");
    return body.RtData;
  });
export async function boardQuotes() {
  const results = await Promise.allSettled(
    ["day", "night"].map((session) =>
      saved("quotes:" + session, 15000, async () => {
        const list = await post("getQuoteList", {
          MarketType: session === "day" ? "0" : "1",
          SymbolType: "F",
          KindID: "1",
          CID: "TXF",
          ExpireMonth: "",
          SortColumn: "",
          AscDesc: "A",
        });
        const items = (list.QuoteList || []).filter(
          (q) => q.SymbolID === "TXF-S" || contractMonth(q.SymbolID, q.CDate),
        );
        const products = items.map((q) =>
          parseBoardQuote(
            q,
            null,
            q.SymbolID === "TXF-S" ? "index" : session,
            new Date().toISOString(),
          ),
        );
        return { products };
      }),
    ),
  );
  return {
    products: results.flatMap((r) =>
      r.status === "fulfilled"
        ? r.value.products.map((p) => ({ ...p, stale: r.value.stale || false }))
        : [],
    ),
    warnings: results.flatMap((r, i) =>
      r.status === "rejected"
        ? [(i === 0 ? "日盤" : "夜盤") + "來源暫時無法取得"]
        : r.value.warning
          ? [r.value.warning]
          : [],
    ),
    received_at: new Date().toISOString(),
  };
}
export async function boardIntraday(symbol, session) {
  return saved("intraday:" + symbol, 15000, async () => {
    const chart = await post("getChartData1M", { SymbolID: symbol });
    if (chart.SymbolID !== symbol) throw Error("來源回傳不同商品");
    const list = await post("getQuoteList", {
      MarketType: session === "night" ? "1" : "0",
      SymbolType: "F",
      KindID: "1",
      CID: "TXF",
      ExpireMonth: "",
      SortColumn: "",
      AscDesc: "A",
    });
    const item = list.QuoteList?.find((q) => q.SymbolID === symbol);
    if (!item) throw Error("指定契約無行情");
    return parseBoardQuote(item, chart, session, new Date().toISOString());
  });
}
export function parseIndexDays(body) {
  if (body.stat !== "OK" || !Array.isArray(body.data))
    throw Error("證交所區間無資料或來源暫時無法取得");
  return body.data
    .map((row) => {
      const parts = row[0].split("/");
      const day = validDate(
        `${Number(parts[0]) + 1911}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`,
      );
      return {
        label: day,
        trade_date: day,
        close: numeric(row[4]),
        change: numeric(row[5]),
        volume: numeric(row[1]),
        turnover: numeric(row[2]),
        is_final: day < taipeiDay(),
      };
    })
    .filter((row) => row.close > 0);
}
export async function boardHistory(product, start, end, contract) {
  const warmupStart = addDays(start, -180);
  if (product === "index") {
    const months = [];
    for (let day = warmupStart.slice(0, 7) + "-01"; day <= end;) {
      months.push(day);
      const d = new Date(day + "T00:00:00Z");
      d.setUTCMonth(d.getUTCMonth() + 1);
      day = d.toISOString().slice(0, 10);
    }
    const data = [];
    const warnings = [];
    for (const month of months) {
      try {
        const result = await saved(
          "index-month:" + month,
          month.slice(0, 7) === taipeiDay().slice(0, 7) ? 300000 : 86400000,
          async () => ({
            data: parseIndexDays(
              await fetchJSON(
                "https://www.twse.com.tw/exchangeReport/FMTQIK?response=json&date=" +
                  month.replaceAll("-", ""),
                { timeout: 12000 },
              ),
            ),
            received_at: new Date().toISOString(),
          }),
        );
        data.push(...result.data);
        if (result.warning) warnings.push(result.warning);
      } catch {
        warnings.push(month.slice(0, 7) + "：無資料或來源暫時無法取得");
      }
    }
    return {
      data: data.filter((r) => r.trade_date >= start && r.trade_date <= end),
      warmup_data: data.filter(
        (r) => r.trade_date >= warmupStart && r.trade_date < start,
      ),
      source_label: "證交所市場成交資訊",
      warnings,
      note: "歷史日線為官方收盤指數；來源沒有開高低，不製作假的日K。成交量以股、成交金額以元呈現。",
    };
  }
  return saved(
    `futures-history:${product}:${contract}:${start}:${end}`,
    3600000,
    async () => {
      const items = await new FinMind().get("TaiwanFuturesDaily", {
        data_id: "TX",
        start_date: warmupStart,
        end_date: end,
      });
      const session = product === "night" ? "after_market" : "position";
      const data = items
        .filter(
          (r) =>
            r.futures_id === "TX" &&
            r.contract_date === contract &&
            r.trading_session === session &&
            r.date >= warmupStart &&
            r.date <= end,
        )
        .map((r) => ({
          label: validDate(r.date),
          trade_date: r.date,
          open: numeric(r.open),
          high: numeric(r.max),
          low: numeric(r.min),
          close: numeric(r.close),
          volume: numeric(r.volume),
          open_interest: numeric(r.open_interest),
          change: numeric(r.spread),
          is_final: r.date < taipeiDay(),
        }))
        .filter(
          (r) =>
            r.close > 0 &&
            r.open > 0 &&
            r.high >= Math.max(r.open, r.close) &&
            r.low <= Math.min(r.open, r.close),
        );
      return {
        data: data.filter((r) => r.trade_date >= start),
        warmup_data: data.filter((r) => r.trade_date < start),
        received_at: new Date().toISOString(),
        source_label: "FinMind 台指期日成交資訊",
        warnings: [],
        note: "依來源交易日期、單一契約月份及日／夜盤分開，不拼接近月連續價格；可用範圍依來源權限。",
      };
    },
  );
}
