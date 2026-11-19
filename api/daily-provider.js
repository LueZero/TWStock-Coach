import { FinMind } from "./providers.js";
import { validateBar } from "./bar-validation.js";
import {
  validDate,
  dailySourceEnd,
  serialQueue,
  sleep,
  daysBetween,
} from "./lib.js";
const serialize = serialQueue();
let lastRequest = 0;
const monthlyCache = new Map();
export function parseTwseDaily(body, symbol, month) {
  if (
    body.stat !== "OK" ||
    !Array.isArray(body.fields) ||
    !Array.isArray(body.data) ||
    body.date?.slice(0, 6) !== month.replaceAll("-", "").slice(0, 6) ||
    !new RegExp(`(?:^|\\s)${symbol}(?:\\s|$)`).test(body.title || "")
  )
    throw Error("證交所歷史日線的標的、月份或回應格式不符");
  const field = (name) => {
    const i = body.fields.indexOf(name);
    if (i < 0) throw Error("證交所日線缺欄位：" + name);
    return i;
  };
  const indices = Object.fromEntries(
    Object.entries({
      date: "日期",
      open: "開盤價",
      high: "最高價",
      low: "最低價",
      close: "收盤價",
      volume: "成交股數",
    }).map(([k, v]) => [k, field(v)]),
  );
  const bars = [],
    rejected = [],
    seen = new Set();
  for (const row of body.data) {
    const date = /^(\d{3})\/(\d{2})\/(\d{2})$/.exec(row[indices.date] || "");
    if (!date) throw Error("證交所日線日期格式不符");
    const day = validDate(`${Number(date[1]) + 1911}-${date[2]}-${date[3]}`);
    if (!day.startsWith(month.slice(0, 7)) || seen.has(day))
      throw Error("證交所回傳月份外或重複日期");
    seen.add(day);
    if (day > dailySourceEnd()) continue;
    const number = (key) => {
      const raw = row[indices[key]];
      return raw != null && String(raw).trim() && /^[\d,.]+$/.test(String(raw))
        ? Number(String(raw).replaceAll(",", ""))
        : NaN;
    };
    try {
      bars.push(
        validateBar({
          market: "TWSE",
          symbol,
          session: "daily_aggregate",
          timeframe: "1d",
          price_basis: "raw",
          trade_date: day,
          timestamp: day + "T13:30:00+08:00",
          open: number("open"),
          high: number("high"),
          low: number("low"),
          close: number("close"),
          volume: number("volume"),
          source: "twse",
          source_volume_unit: "shares",
          source_time: day + "T13:30:00+08:00",
          is_final: true,
          payload: { fields: body.fields, row, endpoint: "STOCK_DAY" },
        }),
      );
    } catch {
      rejected.push({
        date: day,
        row,
        reason: "無有效OHLC或整數成交股數，不補零",
      });
    }
  }
  return { bars, rejected };
}
export class DailyProvider {
  constructor(fetcher = fetch, { signal, fallback, interval = 1500 } = {}) {
    this.fetcher = fetcher;
    this.signal = signal;
    this.interval = interval;
    this.fallback = fallback || new FinMind(fetcher, { signal });
  }
  async month(symbol, month) {
    const key = `${symbol}:${month}`,
      cached = monthlyCache.get(key),
      ttl =
        month.slice(0, 7) === dailySourceEnd().slice(0, 7) ? 300000 : 86400000;
    if (this.fetcher === fetch && cached && Date.now() - cached.at < ttl)
      return cached.data;
    return serialize(async () => {
      this.signal?.throwIfAborted();
      // Another overlapping chart/chip request may have filled this month
      // while this call waited for the official-source rate limiter.
      const ready = monthlyCache.get(key);
      if (this.fetcher === fetch && ready && Date.now() - ready.at < ttl)
        return ready.data;
      await sleep(Math.max(0, this.interval - (Date.now() - lastRequest)));
      this.signal?.throwIfAborted();
      lastRequest = Date.now();
      const url = new URL("https://www.twse.com.tw/exchangeReport/STOCK_DAY");
      url.search = new URLSearchParams({
        response: "json",
        date: month.replaceAll("-", ""),
        stockNo: symbol,
      });
      const response = await this.fetcher(url, {
        redirect: "error",
        signal: AbortSignal.any([
          AbortSignal.timeout(18000),
          ...(this.signal ? [this.signal] : []),
        ]),
      });
      if (!response.ok) throw Error("證交所日線來源暫時無法取得");
      const data = parseTwseDaily(await response.json(), symbol, month);
      if (this.fetcher === fetch) {
        monthlyCache.set(key, { at: Date.now(), data });
        if (monthlyCache.size > 300)
          monthlyCache.delete(monthlyCache.keys().next().value);
      }
      return data;
    });
  }
  async daily(market, symbol, start, end, adjusted = false) {
    // OTC monthly history reports rounded lots, not exact shares. Keep the
    // exact-share source until an equivalent official history is verified.
    if (market !== "TWSE" || adjusted || start < "2010-01-04")
      return this.fallback.daily(market, symbol, start, end, adjusted);
    // Long MA warmups can span 20+ monthly reports. A single free raw-price
    // range request avoids serial month downloads; official reports remain
    // the fallback and each returned bar retains its actual source.
    let bulkError;
    if (daysBetween(end, start) > 93) {
      try {
        const batch = await this.fallback.daily(
          market,
          symbol,
          start,
          end,
          adjusted,
        );
        if (!batch.bars?.length) throw Error("區間來源未回傳日線");
        return batch;
      } catch (error) {
        this.signal?.throwIfAborted();
        bulkError = error;
      }
    }
    try {
      const bars = [],
        rejected = [];
      for (let month = start.slice(0, 7) + "-01"; month <= end;) {
        const batch = await this.month(symbol, month);
        bars.push(
          ...batch.bars.filter(
            (b) => b.trade_date >= start && b.trade_date <= end,
          ),
        );
        rejected.push(
          ...batch.rejected.filter((r) => r.date >= start && r.date <= end),
        );
        const next = new Date(month + "T00:00:00Z");
        next.setUTCMonth(next.getUTCMonth() + 1);
        month = next.toISOString().slice(0, 10);
      }
      if (!bars.length) throw Error("證交所區間無有效日線");
      return {
        bars,
        rejected,
        ...(bulkError
          ? {
              source_warning:
                "區間來源未取得，已使用證交所官方月報；每筆保留實際來源。",
            }
          : {}),
      };
    } catch (error) {
      this.signal?.throwIfAborted();
      if (bulkError) throw error;
      const batch = await this.fallback.daily(
        market,
        symbol,
        start,
        end,
        adjusted,
      );
      return {
        ...batch,
        source_warning:
          "官方歷史日線未完整取得，已改用FinMind；每筆保留實際來源。",
      };
    }
  }
  minutes(...args) {
    return this.fallback.minutes(...args);
  }
  get(...args) {
    return this.fallback.get(...args);
  }
  branches(...args) {
    return this.fallback.branches(...args);
  }
}
