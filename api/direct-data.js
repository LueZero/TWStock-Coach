import { resource, cachedResources } from "./source-cache.js";
import { DailyProvider } from "./daily-provider.js";
import {
  companyProfile,
  tdccDistribution,
  etfHoldings,
  prioritizeSourceGroup,
} from "./providers.js";
import { officialOwnership } from "./ownership-provider.js";
import {
  view as financialView,
  DATASETS as FINANCIAL,
} from "./fundamentals.js";
import { view as equityView, DATASETS as EQUITY } from "./equity.js";
import { report as peerReport } from "./peers.js";
import { getCatalog } from "./market.js";
import { calculate } from "./indicators.js";
import {
  addDays,
  dailySourceEnd,
  taipeiDay,
  now,
  fail,
  stock,
  validDate,
  daysBetween,
} from "./lib.js";
const provider = new DailyProvider();
const state = (e) =>
  e.pending
    ? "updating"
    : e.error
      ? e.value
        ? "partial"
        : "unavailable"
      : Object.keys(e.value?.errors || {}).length
        ? e.value?.snapshots?.length
          ? "partial"
          : "unavailable"
        : "ready";
const envelope = (data, e) => ({
  data,
  state: state(e),
  storage: "memory",
  database_used: false,
  update: {
    details: {
      datasets: {
        ...Object.fromEntries(
          (e.value?.snapshots || []).map((s) => [
            s.dataset,
            {
              status: s.data.length ? "success" : "no_data",
              rows: s.data.length,
            },
          ]),
        ),
        ...Object.fromEntries(
          Object.entries(e.value?.errors || {}).map(([d, message]) => [
            d,
            { status: "failed", message },
          ]),
        ),
        ...e.value?.statuses,
      },
    },
    status: e.pending
      ? "running"
      : e.error
        ? "failed"
        : Object.keys(e.value?.errors || {}).length
          ? "partial"
          : "success",
    message: e.error || null,
  },
  received_at: e.received_at || null,
});
export function barsResource(
  market,
  symbol,
  { start, end, price_basis = "raw", timeframe = "1d" } = {},
) {
  stock(market, symbol);
  validDate(start);
  validDate(end);
  if (
    start > end ||
    daysBetween(end, start) > 12000 ||
    !["raw", "adjusted"].includes(price_basis) ||
    !["1d", "1m"].includes(timeframe)
  )
    fail("行情來源參數不符", 422);
  const key = `bars:${market}:${symbol}:${timeframe}:${price_basis}:${start}:${end}`;
  return resource(
    key,
    async () => {
      const bars = [],
        warnings = [];
      const stop = end < dailySourceEnd() ? end : dailySourceEnd();
      if (start > stop) return { bars, warnings };
      if (timeframe === "1m") {
        if (!process.env.FINMIND_TOKEN)
          fail("分鐘K需具權限的來源，公開報價快照不替代分鐘K", 422);
        for (let day = start; day <= stop; day = addDays(day, 1)) {
          if ([0, 6].includes(new Date(day + "T00:00:00Z").getUTCDay()))
            continue;
          const b = await provider.minutes(market, symbol, day);
          bars.push(...b.bars);
        }
      } else {
        const b = await provider.daily(
          market,
          symbol,
          start,
          stop,
          price_basis === "adjusted",
        );
        bars.push(...b.bars);
        if (b.source_warning) warnings.push(b.source_warning);
        if (b.rejected?.length)
          warnings.push(`${b.rejected.length}筆來源資料未通過驗證。`);
      }
      const received_at = now();
      return {
        bars: calculate(
          bars
            .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
            .map((b) => ({ ...b, received_at, revision: null })),
        ),
        warnings,
      };
    },
    end < taipeiDay() ? 3600000 : 300000,
  );
}
export async function directBars(market, symbol, options) {
  const e = barsResource(market, symbol, options);
  await e.promise;
  if (!e.value) fail(e.error || "行情尚未取得", 503);
  return e.value.bars;
}
function datasetsResource(
  market,
  symbol,
  kind,
  end = taipeiDay(),
  start = addDays(end, -1826),
  priority = kind === "financial" ? 2 : 1,
) {
  const key = `${kind}:${market}:${symbol}:${start}:${end}`;
  return resource(
    key,
    async (previous) => {
      const list =
          kind === "financial"
            ? Object.keys(FINANCIAL)
            : kind === "basic"
              ? ["CompanyProfile"]
              : Object.keys(EQUITY),
        snapshots = [],
        errors = {};
      const statuses = Object.fromEntries(
        list.map((d) => [d, { status: "queued" }]),
      );
      const value = { snapshots, errors, statuses };
      // Publish only real completed datasets as they arrive; no SQL queue.
      const e = resource(key, () => value);
      e.value = value;
      await Promise.all(
        list.map(async (dataset) => {
          const reusable = previous?.snapshots?.find(
            (s) =>
              s.dataset === dataset &&
              Date.now() - Date.parse(s.received_at) < 1800000,
          );
          if (reusable) {
            snapshots.push(reusable);
            statuses[dataset] = {
              status: reusable.data.length ? "success" : "no_data",
              rows: reusable.data.length,
              message:
                reusable.source_note ||
                previous?.statuses?.[dataset]?.message ||
                null,
            };
            return;
          }
          const started = Date.now();
          statuses[dataset] = { status: "loading" };
          try {
            let data,
              source = "finmind",
              sourceNote = null;
            if (
              ["AnalystTargetReport", "FundHoldingsReport"].includes(dataset)
            ) {
              errors[dataset] =
                dataset === "FundHoldingsReport"
                  ? "一般 ETF／基金持股尚未接入來源；不是目前 Token 的權限錯誤。"
                  : "此來源尚未接入直接查詢，不以推估值代替";
              statuses[dataset] = {
                status: "not_connected",
                message: errors[dataset],
              };
              return;
            }
            if (dataset === "TaiwanStockActiveETFHolding") {
              if (!process.env.FINMIND_TOKEN || !process.env.ETF_WATCHLIST) {
                errors[dataset] =
                  "尚未設定 ETF_WATCHLIST；指定主動 ETF 持股另需 FinMind Sponsor 權限。";
                statuses[dataset] = {
                  status: "not_configured",
                  message: errors[dataset],
                };
                return;
              }
              data = await etfHoldings(provider, symbol, end, start);
            } else if (dataset === "CompanyProfile") {
              data = await companyProfile(market, symbol);
              source = market.toLowerCase();
            } else if (
              ["DirectorHoldingsReport", "InsiderTransfersReport"].includes(
                dataset,
              )
            ) {
              data = await officialOwnership(market, symbol, dataset);
              source = market.toLowerCase();
            } else if (dataset === "TaiwanStockHoldingSharesPer") {
              if (process.env.FINMIND_TOKEN) {
                try {
                  data = await provider.get(dataset, {
                    data_id: symbol,
                    start_date: start,
                    end_date: end,
                  });
                } catch (error) {
                  if (error.code !== "SOURCE_PERMISSION") throw error;
                  data = await tdccDistribution(symbol);
                  source = "tdcc";
                  sourceNote =
                    "歷史股權分布權限不足，改用集保最新免費週資料；不提供完整歷史週線。";
                }
              } else {
                data = await tdccDistribution(symbol);
                source = "tdcc";
                sourceNote = "集保最新免費週資料；不提供完整歷史週線。";
              }
            } else if (
              [
                "TaiwanStockBrokerDailyConcentration",
                "TaiwanStockTradingDailyReport",
              ].includes(dataset)
            ) {
              if (!process.env.FINMIND_TOKEN) {
                errors[dataset] = "需相應授權來源與Token";
                statuses[dataset] = {
                  status: "requires_token",
                  message: errors[dataset],
                };
                return;
              }
              data =
                dataset === "TaiwanStockTradingDailyReport"
                  ? await provider.branches(symbol, end)
                  : await provider.get(dataset, {
                      data_id: symbol,
                      start_date: start,
                      end_date: end,
                    });
            } else
              data = await provider.get(
                dataset,
                {
                  data_id: symbol,
                  start_date: start,
                  end_date: end,
                },
                {
                  priority,
                  key:
                    kind === "financial"
                      ? `financial:${market}:${symbol}`
                      : null,
                },
              );
            if (!Array.isArray(data)) throw Error("來源格式不符");
            if (
              data.some(
                (r) => r.stock_id != null && String(r.stock_id) !== symbol,
              )
            )
              throw Error("來源回傳不同股票");
            snapshots.push({
              market,
              symbol,
              dataset,
              source,
              received_at: now(),
              revision: null,
              id: null,
              data,
              source_note: sourceNote,
            });
            statuses[dataset] = {
              status: data.length ? "success" : "no_data",
              rows: data.length,
              elapsed_ms: Date.now() - started,
              message:
                sourceNote ||
                (dataset === "InsiderTransfersReport" && !data.length
                  ? "官方來源本次未回傳此股票的申報轉讓紀錄；不代表歷史從未申報。"
                  : null),
            };
          } catch (error) {
            errors[dataset] = [
              "SOURCE_BUDGET",
              "SOURCE_PERMISSION",
              "SOURCE_AUTH",
              "SOURCE_QUOTA",
              "SOURCE_BLOCKED",
            ].includes(error.code)
              ? error.message
              : /^FinMind (HTTP \d+; check entitlement\/quota|transport unavailable|dataset unavailable; check entitlement\/quota|retry budget exhausted)$/.test(
                    error.message,
                  )
                ? error.message
                : "來源請求失敗，並非確認沒有資料";
            if (error.code === "SOURCE_PERMISSION" && EQUITY[dataset]?.[1])
              errors[dataset] =
                `目前帳戶權限不足；此資料集需要 ${EQUITY[dataset][1]}。`;
            statuses[dataset] = {
              status:
                {
                  SOURCE_PERMISSION: "permission_denied",
                  SOURCE_AUTH: "invalid_token",
                  SOURCE_QUOTA: "quota_exceeded",
                  SOURCE_BUDGET: "quota_exceeded",
                  SOURCE_BLOCKED: "source_blocked",
                }[error.code] || "source_error",
              message: errors[dataset],
              elapsed_ms: Date.now() - started,
            };
          }
        }),
      );
      return value;
    },
    1800000,
    {
      retryWhen: (value) =>
        Object.values(value.statuses || {}).some((s) =>
          ["source_error", "quota_exceeded", "source_blocked"].includes(
            s.status,
          ),
        ),
    },
  );
}
export async function directFinancial(
  market,
  symbol,
  asOf = null,
  raw = false,
  background = false,
) {
  if (!asOf && !background)
    prioritizeSourceGroup(`financial:${market}:${symbol}`);
  const historical = Boolean(asOf),
    e = historical
      ? null
      : datasetsResource(
          market,
          symbol,
          "financial",
          taipeiDay(),
          addDays(taipeiDay(), -1826),
          background ? 0 : 2,
        );
  const count = e?.value?.snapshots?.length || 0;
  const cacheKey = String(Boolean(raw));
  if (e && !e.financialViews) e.financialViews = new Map();
  let cached = e?.financialViews.get(cacheKey);
  if (!cached || cached.count !== count) {
    cached = {
      count,
      promise: financialView(
        market,
        symbol,
        asOf || now(),
        raw,
        null,
        async () => e?.value?.snapshots || [],
      ),
    };
    if (e) e.financialViews.set(cacheKey, cached);
  }
  const result = { ...(await cached.promise) };
  result.storage = "memory";
  result.source_status = historical ? "historical_unavailable" : state(e);
  result.database_used = false;
  result.availability_basis = "current_source_observation";
  result.note = historical
    ? "純API模式不能重建歷史當時可得財報版本；未將現在取得的資料回填至當年。"
    : "來源API直接取得，僅記憶體快取；來源報表日期不等於公告日，無DB修訂歷史。";
  result.source_errors = e?.value?.errors || {};
  if (e)
    result.coverage = result.coverage.map((row) => ({
      ...row,
      status:
        e.value?.statuses?.[row.dataset]?.status === "success"
          ? "available"
          : e.value?.statuses?.[row.dataset]?.status || "queued",
      message: e.value?.statuses?.[row.dataset]?.message || null,
    }));
  if (e?.pending)
    result.note +=
      " 資料仍在來源取得中，稍後可重新查詢；空值不代表公司沒有營收或獲利。";
  result.revision_history = [];
  return historical
    ? {
        data: result,
        state: "unavailable",
        storage: "memory",
        database_used: false,
        update: { status: "historical_unavailable", message: result.note },
      }
    : envelope(result, e);
}
export async function directEquity(
  market,
  symbol,
  start,
  end,
  asOf = null,
  kind = "equity",
) {
  const historical = Boolean(asOf),
    e = historical ? null : datasetsResource(market, symbol, kind, end, start),
    prices =
      historical || kind === "basic"
        ? null
        : barsResource(market, symbol, {
            start: addDays(start, -90),
            end,
            price_basis: "raw",
            timeframe: "1d",
          });
  // Resolve catalog before reading snapshots. A cold catalog can take long
  // enough for all datasets to finish; do not return a pre-catalog empty view
  // accompanied by post-catalog "available" statuses.
  const instrument = (await getCatalog()).find(
    (i) => i.market === market && i.symbol === symbol,
  );
  const result = await equityView(market, symbol, start, end, asOf || now(), {
    snapshots: async () => e?.value?.snapshots || [],
    dailyPrices: async () => prices?.value?.bars || [],
    instrument: async () => instrument,
  });
  result.storage = "memory";
  result.database_used = false;
  result.source_errors = e?.value?.errors || {};
  result.source_status = historical ? "historical_unavailable" : state(e);
  if (historical)
    return {
      data: result,
      state: "unavailable",
      storage: "memory",
      database_used: false,
      update: {
        status: "historical_unavailable",
        message: "純API模式不能重建歷史當時可得籌碼版本。",
      },
    };
  result.coverage = result.coverage.map((row) => {
    const status = e.value?.statuses?.[row.dataset];
    const snapshot = e.value?.snapshots?.find((s) => s.dataset === row.dataset);
    const outside =
      row.dataset !== "CompanyProfile" &&
      snapshot?.data.length &&
      !snapshot.data.some((r) => start <= r.date && r.date <= end);
    return {
      ...row,
      status:
        status?.status === "success"
          ? outside
            ? "outside_range"
            : "available"
          : status?.status || (kind === "basic" ? "not_requested" : "queued"),
      message: outside
        ? "來源有資料，但不在所選區間；不以最新資料冒充歷史資料。"
        : status?.message || null,
    };
  });
  const response = envelope(result, e);
  if (prices) {
    result.price_context = {
      state: state(prices),
      message: prices.error || prices.value?.warnings?.join("；") || null,
    };
    if (prices.pending) {
      response.state = "updating";
      response.update.status = "running";
    } else if (prices.error) {
      if (response.state === "ready") response.state = "partial";
      response.update.message = "籌碼疊圖的歷史行情未取得；籌碼資料仍可查看。";
    }
  }
  return response;
}
export async function directPeers(
  market,
  symbol,
  reference,
  mode,
  alignment,
  requested,
) {
  const all = await getCatalog(),
    historical = mode === "historical";
  const readers = {
    instruments: async () => all,
    snapshots: async (datasets, receipt) =>
      historical
        ? []
        : cachedResources()
            .flatMap((e) => e.value?.snapshots || [])
            .filter(
              (s) => datasets.includes(s.dataset) && s.received_at <= receipt,
            )
            .sort((a, b) => b.received_at.localeCompare(a.received_at)),
  };
  const result = await peerReport(
    market,
    symbol,
    reference,
    mode,
    alignment,
    requested,
    null,
    readers,
  );
  return {
    ...result,
    storage: "memory",
    database_used: false,
    note:
      result.note +
      (historical
        ? " 純API模式不提供歷史當時已知資料版本。"
        : " 財務只使用來源API已取得的記憶體資料，未取得者需按需載入。"),
  };
}
