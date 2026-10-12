import Decimal from "decimal.js";
import {
  addDays,
  taipeiDay,
  dailySourceEnd,
  validDate,
  num,
  sleep,
  serialQueue,
  fetchJSON,
  fail,
} from "./lib.js";
import { validateBar } from "./service.js";
const serialize = serialQueue();
let lastRequest = 0;
export class FinMind {
  constructor(fetcher = fetch, { signal } = {}) {
    this.fetcher = fetcher;
    this.signal = signal;
    const interval = Number(process.env.FINMIND_REQUEST_INTERVAL ?? 8);
    this.interval =
      (Number.isFinite(interval) ? Math.max(1, interval) : 8) * 1000;
  }
  async request(endpoint, params) {
    return serialize(async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        this.signal?.throwIfAborted();
        await sleep(Math.max(0, this.interval - (Date.now() - lastRequest)));
        this.signal?.throwIfAborted();
        lastRequest = Date.now();
        let response;
        try {
          response = await this.fetcher(
            endpoint + "?" + new URLSearchParams(params),
            {
              signal: this.signal
                ? AbortSignal.any([AbortSignal.timeout(45000), this.signal])
                : AbortSignal.timeout(45000),
              headers: process.env.FINMIND_TOKEN
                ? { Authorization: "Bearer " + process.env.FINMIND_TOKEN }
                : {},
            },
          );
        } catch {
          this.signal?.throwIfAborted();
          if (attempt === 3) throw Error("FinMind transport unavailable");
          await sleep(2 ** attempt * 1000);
          continue;
        }
        if (
          (response.status === 429 || response.status >= 500) &&
          attempt < 3
        ) {
          await sleep(2 ** attempt * 5000);
          continue;
        }
        if (!response.ok)
          throw Error(
            `FinMind HTTP ${response.status}; check entitlement/quota`,
          );
        const body = await response.json();
        if (body.status !== 200 || !Array.isArray(body.data))
          throw Error("FinMind dataset unavailable; check entitlement/quota");
        return body.data;
      }
      throw Error("FinMind retry budget exhausted");
    });
  }
  get(dataset, params = {}) {
    return this.request("https://api.finmindtrade.com/api/v4/data", {
      dataset,
      ...params,
    });
  }
  branches(symbol, day) {
    return this.request(
      "https://api.finmindtrade.com/api/v4/taiwan_stock_trading_daily_report",
      { data_id: symbol, date: day },
    );
  }
  async daily(market, symbol, start, end, adjusted = false) {
    const items = await this.get(
        adjusted ? "TaiwanStockPriceAdj" : "TaiwanStockPrice",
        { data_id: symbol, start_date: start, end_date: end },
      ),
      bars = [],
      rejected = [];
    for (const item of items) {
      const day = validDate(item.date);
      if (item.stock_id !== symbol || day < start || day > end)
        throw Error("Provider returned a different symbol/date range");
      if (day > dailySourceEnd()) continue;
      try {
        bars.push(
          validateBar({
            market,
            symbol,
            session: "daily_aggregate",
            timeframe: "1d",
            price_basis: adjusted ? "adjusted" : "raw",
            timestamp: day + "T13:30:00+08:00",
            trade_date: day,
            open: item.open,
            high: item.max,
            low: item.min,
            close: item.close,
            volume: item.Trading_Volume,
            source_volume_unit: "shares",
            source: "finmind",
            source_time: day + "T13:30:00+08:00",
            is_final: true,
            payload: item,
          }),
        );
      } catch {
        rejected.push(item);
      }
    }
    return { bars, rejected };
  }
  async minutes(market, symbol, day) {
    if (!process.env.FINMIND_TOKEN)
      throw Error(
        "分鐘 K 線需要 FINMIND_TOKEN 與 FinMind Sponsor 權限；可先使用日 K 或公開快照走勢。",
      );
    const items = await this.get("TaiwanStockKBar", {
        data_id: symbol,
        start_date: day,
      }),
      bars = [],
      rejected = [];
    for (const item of items) {
      if (item.stock_id !== symbol || item.date !== day)
        throw Error("Provider returned a different symbol/date");
      try {
        const stamp = new Date(`${day}T${item.minute}+08:00`).toISOString(),
          shares = new Decimal(item.volume).mul(1000);
        if (!shares.isInteger()) throw Error("Fractional shares");
        bars.push(
          validateBar({
            market,
            symbol,
            session: "regular",
            timeframe: "1m",
            price_basis: "raw",
            timestamp: stamp,
            trade_date: day,
            open: item.open,
            high: item.high,
            low: item.low,
            close: item.close,
            volume: shares.toNumber(),
            source_volume_unit: "lots",
            source: "finmind",
            source_time: new Date(Date.parse(stamp) + 60000).toISOString(),
            is_final: true,
            payload: item,
          }),
        );
      } catch {
        rejected.push(item);
      }
    }
    return { bars, rejected };
  }
}
export function* chunks(start, end) {
  while (start <= end) {
    const stop = addDays(start, 365) < end ? addDays(start, 365) : end;
    yield [start, stop];
    start = addDays(stop, 1);
  }
}
const profileCache = new Map();
let tdccCache;
export async function companyProfile(market, symbol) {
  const url =
    market === "TWSE"
      ? "https://openapi.twse.com.tw/v1/opendata/t187ap03_L"
      : "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O";
  let cached = profileCache.get(market);
  if (!cached || Date.now() - cached.at > 86400000) {
    const items = await fetchJSON(url, 20000);
    if (!Array.isArray(items)) throw Error("公司資料格式不符");
    cached = { at: Date.now(), items };
    profileCache.set(market, cached);
  }
  const original = cached.items.find(
    (r) => String(r["公司代號"] ?? r.SecuritiesCompanyCode) === symbol,
  );
  if (!original) return [];
  const profile = { ...original };
  if (market === "TPEX")
    for (const [label, field] of Object.entries({
      出表日期: "Date",
      公司代號: "SecuritiesCompanyCode",
      公司名稱: "CompanyName",
      公司簡稱: "CompanyAbbreviation",
      產業別: "SecuritiesIndustryCode",
      董事長: "Chairman",
      成立日期: "DateOfIncorporation",
      上市日期: "DateOfListing",
      實收資本額: "Paidin.Capital.NTDollars",
      網址: "WebAddress",
      地址: "Address",
      已發行普通股數或TDR原股發行股數: "IssueShares",
    }))
      profile[label] = profile[field] ?? null;
  return [{ stock_id: symbol, date: taipeiDay(), source_url: url, profile }];
}
export const TDCC_LEVELS = [
  "1-999",
  "1000-5000",
  "5001-10000",
  "10001-15000",
  "15001-20000",
  "20001-30000",
  "30001-40000",
  "40001-50000",
  "50001-100000",
  "100001-200000",
  "200001-400000",
  "400001-600000",
  "600001-800000",
  "800001-1000000",
  "morethan1000000",
  "差異數",
  "total",
];
export function parseDistribution(records, symbol) {
  const result = [];
  for (const original of records) {
    const r = Object.fromEntries(
      Object.entries(original).map(([k, v]) => [k.replace(/^\uFEFF/, ""), v]),
    );
    if (String(r["證券代號"] ?? "").trim() !== symbol) continue;
    const date = String(r["資料日期"]),
      day = validDate(
        `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
      ),
      level = Number(r["持股分級"]),
      shares = num(r["股數"]),
      people = num(r["人數"]),
      percent = num(r["占集保庫存數比例%"]);
    if (
      !Number.isInteger(level) ||
      level < 1 ||
      level > 17 ||
      day > taipeiDay() ||
      !Number.isSafeInteger(shares) ||
      !Number.isSafeInteger(people) ||
      people < 0 ||
      percent == null ||
      (level !== 16 && (shares < 0 || percent < 0 || percent > 100))
    )
      throw Error("集保資料日期、分級或數值不符");
    result.push({
      stock_id: symbol,
      date: day,
      HoldingSharesLevel: TDCC_LEVELS[level - 1],
      unit: shares,
      people,
      percent,
      source_url: "https://openapi.tdcc.com.tw/v1/opendata/1-5",
    });
  }
  if (
    result.length &&
    (result.length !== 17 ||
      new Set(result.map((r) => r.HoldingSharesLevel)).size !== 17)
  )
    throw Error("集保級距不完整，不計算部分占比");
  return result;
}
export async function tdccDistribution(symbol) {
  if (!tdccCache || Date.now() - tdccCache.at > 86400000) {
    const records = await fetchJSON(
      "https://openapi.tdcc.com.tw/v1/opendata/1-5",
      30000,
    );
    if (!Array.isArray(records) || !records.length)
      throw Error("集保資料格式不符");
    tdccCache = { at: Date.now(), records };
  }
  return parseDistribution(tdccCache.records, symbol);
}
export async function etfHoldings(provider, symbol, end) {
  const codes = [
    ...new Set(
      (process.env.ETF_WATCHLIST ?? "")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
    ),
  ];
  if (
    !codes.length ||
    codes.length > 10 ||
    codes.some((c) => !/^[A-Za-z0-9]{2,16}$/.test(c))
  )
    fail("請設定最多10檔有效主動ETF代碼");
  const result = [];
  for (const code of codes) {
    const items = await provider.get("TaiwanStockActiveETFHolding", {
      data_id: code,
      start_date:
        addDays(end, -1826) > "2025-05-05" ? addDays(end, -1826) : "2025-05-05",
      end_date: end,
    });
    for (const r of items) {
      if (r.stock_id !== code) throw Error("來源ETF代碼不符");
      if (
        r.component_stock_id === symbol &&
        r.asset_type === "stock" &&
        r.currency === "TWD"
      ) {
        const shares = num(r.shares),
          weight = num(r.weight);
        if (
          !Number.isSafeInteger(shares) ||
          shares < 0 ||
          (weight != null && (weight < 0 || weight > 100))
        )
          throw Error("ETF持股數值不符");
        result.push({
          stock_id: symbol,
          date: r.date,
          fund_code: code,
          fund_name: code,
          holding_shares: shares,
          weight_percent: weight,
          source_url: "https://finmind.github.io/tutor/TaiwanMarket/Chip/",
        });
      }
    }
  }
  return result;
}
