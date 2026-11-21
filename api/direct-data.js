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
import { fundPeers } from "./fund-data.js";
import { officialBookValue } from "./official-financial.js";
import { valuationBands } from "./valuation-bands.js";
import { tdccHistory } from "./tdcc-history.js";
import { calculate } from "./indicators.js";
import {
  isEtf,
  ETF_COMPANY_DATASETS,
  annotateFinancialAvailability,
  sourceObservation,
} from "./data-availability.js";
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
              previous?.statuses?.[dataset]?.status !== "partial" &&
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
              sourceNote = null,
              sourceCoverage = null;
            if (
              isEtf(symbol) &&
              ((kind === "financial" &&
                (ETF_COMPANY_DATASETS.has(dataset) ||
                  dataset === "OfficialBookValue")) ||
                ["DirectorHoldingsReport", "InsiderTransfersReport"].includes(
                  dataset,
                ))
            ) {
              statuses[dataset] = {
                status: "not_applicable",
                message:
                  "此資料集是公司營運／內部人揭露口徑，不適用 ETF；不是目前 Token 權限不足。",
              };
              return;
            }
            if (
              dataset === "CompanyProfile" &&
              isEtf(symbol) &&
              market !== "TWSE"
            ) {
              errors[dataset] =
                "上櫃 ETF 基金基本資料來源尚未接入；目前名稱來自股票目錄。";
              statuses[dataset] = {
                status: "not_connected",
                message: errors[dataset],
              };
              return;
            }
            if (
              ["AnalystTargetReport", "FundHoldingsReport"].includes(dataset)
            ) {
              errors[dataset] =
                dataset === "FundHoldingsReport"
                  ? "全市場基金正式持股尚未接入；本頁另提供群益公開 PCF 補充，兩者口徑不同。"
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
            } else if (dataset === "OfficialBookValue") {
              data = await officialBookValue(market, symbol);
              source = market.toLowerCase();
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
              try {
                const progress = (rows, meta) => {
                  if (!rows.length) return;
                  let snapshot = snapshots.find((s) => s.dataset === dataset);
                  if (!snapshot) {
                    snapshot = {
                      market,
                      symbol,
                      dataset,
                      source: "tdcc_history",
                      received_at: now(),
                      revision: null,
                      id: null,
                    };
                    snapshots.push(snapshot);
                  }
                  snapshot.data = [...rows];
                  snapshot.observation = {
                    ...sourceObservation(dataset, "tdcc_history", rows),
                    ...meta,
                  };
                  statuses[dataset] = {
                    status: "loading",
                    rows: rows.length,
                    message: `集保免費歷史已取得 ${meta.loaded_weeks}/${meta.requested_weeks} 週；其餘仍在查詢。`,
                  };
                };
                const result = await tdccHistory(symbol, start, end, progress);
                sourceCoverage = result.coverage;
                data = result.data;
                source = "tdcc_history";
                sourceNote = `集保官網提供 ${result.coverage.available_start}～${result.coverage.available_end}，本區間取得 ${result.coverage.loaded_weeks}/${result.coverage.requested_weeks} 週；${result.coverage.failed_weeks.length} 週失敗、${result.coverage.skipped_weeks.length} 週因連續失敗尚未查詢，不補值。`;
                if (!result.coverage.requested_weeks) {
                  data = await tdccDistribution(symbol);
                  source = "tdcc";
                  sourceCoverage = null;
                  sourceNote +=
                    " 所選區間沒有官方可查週別；僅核對最新免費週資料，不回填歷史。";
                }
                const partial = snapshots.find((s) => s.dataset === dataset);
                if (partial) snapshots.splice(snapshots.indexOf(partial), 1);
              } catch {
                const partial = snapshots.find((s) => s.dataset === dataset);
                if (partial) snapshots.splice(snapshots.indexOf(partial), 1);
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
                      "官網歷史本次未取得，備援歷史權限不足，改用集保最新免費週資料；不冒充所選區間完整歷史。";
                  }
                } else {
                  data = await tdccDistribution(symbol);
                  source = "tdcc";
                  sourceNote =
                    "官網歷史本次未取得，改用集保最新免費週資料；不冒充完整歷史。";
                }
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
              observation: {
                ...sourceObservation(dataset, source, data),
                ...(sourceCoverage || {}),
              },
            });
            if (sourceCoverage?.failed_weeks.length)
              errors[dataset] = sourceNote;
            statuses[dataset] = {
              status: sourceCoverage?.failed_weeks.length
                ? "partial"
                : data.length
                  ? "success"
                  : "no_data",
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
          [
            "source_error",
            "quota_exceeded",
            "source_blocked",
            "partial",
          ].includes(s.status),
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
  let result = { ...(await cached.promise) };
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
      ...e.value?.snapshots?.find((s) => s.dataset === row.dataset)
        ?.observation,
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
  result = annotateFinancialAvailability(result, symbol);
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
  result.instrument_type = isEtf(symbol) ? "etf" : "stock";
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
      !snapshot.data.some((r) =>
        row.dataset === "DirectorHoldingsReport"
          ? r.date <= end
          : start <= r.date && r.date <= end,
      );
    return {
      ...row,
      ...snapshot?.observation,
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
export async function directValuationBands(market, symbol, start, end, field) {
  const e = datasetsResource(market, symbol, "financial");
  await e.promise;
  const snapshot = e.value?.snapshots.find(
    (s) => s.dataset === "TaiwanStockPER",
  );
  const first = addDays(start, -400),
    earliest = addDays(taipeiDay(), -1826);
  if (end < earliest)
    return {
      rows: [],
      market,
      symbol,
      start,
      end,
      status: "outside_range",
      source_status: "outside_range",
      storage: "memory",
      database_used: false,
      note: "來源估值目前取得最近五年，所選區間早於來源範圍，未回填最新資料。",
    };
  const bars = await directBars(market, symbol, {
    start: first > earliest ? first : earliest,
    end,
    price_basis: "raw",
    timeframe: "1d",
  });
  const data = valuationBands(bars, snapshot?.data || [], field);
  data.rows = data.rows.filter((r) => start <= r.date && r.date <= end);
  return {
    ...data,
    market,
    symbol,
    start,
    end,
    status: data.rows.length
      ? "available"
      : e.value?.statuses?.TaiwanStockPER?.status === "success"
        ? "calculation_unavailable"
        : e.value?.statuses?.TaiwanStockPER?.status || "no_data",
    source_status: e.value?.statuses?.TaiwanStockPER?.status || "no_data",
    source_received_at: snapshot?.received_at || null,
    storage: "memory",
    database_used: false,
  };
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
  if (isEtf(symbol) && !historical) {
    if (!all.some((i) => i.market === market && i.symbol === symbol))
      fail("股票目錄沒有此市場與代號", 404);
    return fundPeers(market, symbol, reference, requested);
  }
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
