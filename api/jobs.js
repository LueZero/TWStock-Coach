import { pool, rows, query, transaction } from "./db.js";
import {
  now,
  taipeiDay,
  addDays,
  stock,
  validDate,
  integer,
  daysBetween,
  fail,
  sleep,
} from "./lib.js";
import {
  FinMind,
  chunks,
  companyProfile,
  tdccDistribution,
  etfHoldings,
} from "./providers.js";
import { ingest } from "./service.js";
import {
  DATASETS as FINANCIAL,
  saveSnapshot,
  snapshots,
} from "./fundamentals.js";
import { DATASETS as EQUITY, replaceObservationWindow } from "./equity.js";
import { tradingRange } from "./trading.js";
export function historyRequest(r) {
  stock(r.market, r.symbol);
  validDate(r.start);
  validDate(r.end);
  r = { price_basis: "raw", timeframe: "1d", warmup_days: 420, ...r };
  if (
    !["raw", "adjusted"].includes(r.price_basis) ||
    !["1d", "1m"].includes(r.timeframe)
  )
    fail("無效歷史行情週期或價格基準");
  integer(r.warmup_days, 420, 8000, "暖機日數");
  if (
    r.start < "1994-10-01" ||
    r.start > r.end ||
    daysBetween(r.end, r.start) > 3653 ||
    r.end >= taipeiDay()
  )
    fail("歷史範圍需由早到晚、最多十年、1994年10月起且截止早於今日");
  if (
    r.timeframe === "1m" &&
    (daysBetween(r.end, r.start) > 30 ||
      r.start < "2019-01-01" ||
      r.price_basis !== "raw")
  )
    fail("分鐘來源僅提供2019年起原始價格，一次最多31日");
  return r;
}
export async function enqueue(
  kind,
  r,
  force = false,
  { warmup = true, priority = kind === "history" ? 20 : 10 } = {},
) {
  stock(r.market, r.symbol);
  if (kind === "history") r = historyRequest(r);
  if (kind === "equity") {
    validDate(r.end);
    if (r.end > taipeiDay()) fail("截止日期不能在未來");
  }
  const first =
      kind === "history" && !warmup
        ? r.start
        : kind === "history"
          ? r.timeframe === "1m"
            ? maxDate("2019-01-01", addDays(r.start, -14))
            : maxDate("1994-10-01", addDays(r.start, -r.warmup_days))
          : null,
    name =
      kind === "history"
        ? `ondemand:${r.market}:${r.symbol}:${r.price_basis}${r.timeframe === "1m" ? ":1m" : ""}`
        : kind === "equity"
          ? `equity:${r.market}:${r.symbol}:${r.end}:tdcc-v1`
          : `fundamentals:${r.market}:${r.symbol}`,
    details =
      kind === "history"
        ? {
            start: first,
            end: r.end,
            symbol: r.symbol,
            market: r.market,
            timeframe: r.timeframe,
            requested_start: r.start,
            requested_end: r.end,
          }
        : { datasets: {} },
    payload = {
      ...r,
      kind,
      ...(first ? { start: first } : {}),
      price_basis: r.price_basis ?? "raw",
    };
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(78241003)");
    const recent = (
      await client.query(
        "SELECT * FROM job_runs WHERE name=$1 AND (status IN ('queued','running') OR started_at>now()-$2::interval) ORDER BY id DESC",
        [name, kind === "history" ? "6 hours" : "24 hours"],
      )
    ).rows;
    if (
      kind === "history" &&
      r.timeframe === "1m" &&
      !process.env.FINMIND_TOKEN
    ) {
      const covered = recent.filter(
        (j) =>
          (j.details.start ?? "9999") <= first &&
          (j.details.end ?? "0000") >= r.end,
      );
      const completed = covered.find((j) =>
        ["success", "quality_warning"].includes(j.status),
      );
      if (completed)
        return {
          job_id: completed.id,
          status: completed.status,
          details: completed.details,
        };
      const info = {
        ...details,
        reason: "requires_token",
        message:
          "分鐘 K 線需要 FINMIND_TOKEN 與 FinMind Sponsor 權限；可先使用日 K 或公開快照走勢。",
      };
      const existing = covered.find(
        (j) => j.status === "queued" || j.details.reason === "requires_token",
      );
      let id = existing?.id;
      if (id)
        await client.query(
          "UPDATE job_runs SET status='failed',finished_at=now(),details=$2 WHERE id=$1",
          [id, JSON.stringify(info)],
        );
      else
        id = (
          await client.query(
            "INSERT INTO job_runs(name,status,started_at,finished_at,details,payload,priority) VALUES($1,'failed',now(),now(),$2,$3,$4) RETURNING id",
            [name, JSON.stringify(info), JSON.stringify(payload), priority],
          )
        ).rows[0].id;
      return {
        job_id: id,
        status: "failed",
        details: info,
        message: info.message,
      };
    }
    for (const job of recent) {
      const age = Date.now() - new Date(job.started_at).getTime(),
        active = ["queued", "running"].includes(job.status);
      // Waiting is not a failed heartbeat. Only the exclusive worker recovers
      // interrupted jobs after acquiring its session lock.
      if (force && !active) continue;
      const covered =
          kind !== "history" ||
          ((job.details.start ?? "9999") <= first &&
            (job.details.end ?? "0000") >= r.end),
        good = ["success", "quality_warning"].includes(job.status);
      if (
        covered &&
        (active ||
          (good && kind === "history") ||
          job.status === "success" ||
          (kind === "fundamentals" &&
            job.status === "quality_warning" &&
            !Object.values(job.details.datasets ?? {}).some(
              (s) => s.status === "failed",
            )) ||
          (kind !== "history" && age < 3600000))
      )
        return {
          job_id: job.id,
          status: job.status,
          details: job.details,
          message: "已使用相同區間的載入工作",
        };
    }
    const prefix = kind === "history" ? "ondemand:" : kind + ":",
      cap = kind === "history" ? 6 : kind === "equity" ? 3 : 4,
      count = Number(
        (
          await client.query(
            "SELECT count(*) FROM job_runs WHERE name LIKE $1 AND priority>0 AND status IN ('queued','running')",
            [prefix + "%"],
          )
        ).rows[0].count,
      );
    if (priority > 0 && count >= cap) fail("目前載入工作較多，請稍後再試", 429);
    const job = (
      await client.query(
        "INSERT INTO job_runs(name,status,started_at,details,payload,priority) VALUES($1,'queued',now(),$2,$3,$4) RETURNING id",
        [name, JSON.stringify(details), JSON.stringify(payload), priority],
      )
    ).rows[0];
    return {
      job_id: job.id,
      status: "queued",
      message: "已加入持久化載入佇列",
    };
  });
}
const maxDate = (a, b) => (a > b ? a : b);
async function progress(id, details) {
  await query(
    "UPDATE job_runs SET details=details::jsonb||$2::jsonb,heartbeat_at=now() WHERE id=$1",
    [id, JSON.stringify(details)],
  );
}
async function finish(id, status, details) {
  await query(
    "UPDATE job_runs SET status=$2,finished_at=now(),heartbeat_at=now(),details=details::jsonb||$3::jsonb WHERE id=$1",
    [id, status, JSON.stringify(details)],
  );
}
export async function executeJob(
  job,
  provider = new FinMind(),
  { signal } = {},
) {
  signal?.throwIfAborted();
  const r = job.payload,
    id = job.id;
  if (r.kind === "history") {
    const total = { changed: 0, unchanged: 0, stale_ignored: 0 },
      rejected = [];
    try {
      const ranges =
        r.timeframe === "1m"
          ? Array.from({ length: daysBetween(r.end, r.start) + 1 }, (_, i) => [
              addDays(r.start, i),
              addDays(r.start, i),
            ])
          : [...chunks(r.start, r.end)];
      for (const [start, end] of ranges) {
        signal?.throwIfAborted();
        if (
          r.timeframe === "1m" &&
          [0, 6].includes(new Date(start + "T00:00:00Z").getUTCDay())
        )
          continue;
        const batch =
          r.timeframe === "1m"
            ? await provider.minutes(r.market, r.symbol, start)
            : await provider.daily(
                r.market,
                r.symbol,
                start,
                end,
                r.price_basis === "adjusted",
              );
        signal?.throwIfAborted();
        const result = await ingest(batch.bars);
        for (const k of Object.keys(total)) total[k] += result[k];
        rejected.push(...batch.rejected);
        await progress(id, { loaded_through: end, ...total });
      }
      await finish(
        id,
        rejected.length
          ? "quality_warning"
          : total.changed + total.unchanged
            ? "success"
            : "no_data",
        { ...total, rejected_count: rejected.length, rejected_rows: rejected },
      );
    } catch (error) {
      signal?.throwIfAborted();
      await finish(id, "failed", {
        message:
          r.timeframe === "1m" && !process.env.FINMIND_TOKEN
            ? error.message
            : "歷史資料載入失敗，請檢查來源權限、配額、網路或資料品質",
      });
    }
    return;
  }
  const datasets = r.kind === "equity" ? EQUITY : FINANCIAL,
    statuses = {},
    end = r.end ?? taipeiDay();
  for (const [dataset, definition] of Object.entries(datasets)) {
    signal?.throwIfAborted();
    const [label, entitlement] = Array.isArray(definition)
      ? definition
      : [definition, null];
    if (
      r.kind === "equity" &&
      ["AnalystTargetReport", "FundHoldingsReport"].includes(dataset)
    )
      statuses[dataset] = {
        status: "not_connected",
        message: `${label}需接入授權來源；可透過資料匯入 API 保存具日期及來源的揭露。`,
      };
    else if (
      entitlement &&
      dataset !== "TaiwanStockHoldingSharesPer" &&
      !process.env.FINMIND_TOKEN
    )
      statuses[dataset] = {
        status: "requires_token",
        message: `需要 FinMind Token 與 ${entitlement} 權限。`,
      };
    else if (
      dataset === "TaiwanStockActiveETFHolding" &&
      !process.env.ETF_WATCHLIST
    )
      statuses[dataset] = {
        status: "not_configured",
        message: "尚未設定 ETF_WATCHLIST；只查詢指定主動ETF。",
      };
    else {
      try {
        let start = addDays(end, -1826),
          windowEnd = end,
          source = "finmind",
          codes = null,
          items;
        if (dataset === "CompanyProfile") {
          items = await companyProfile(r.market, r.symbol);
          source = r.market === "TWSE" ? "twse" : "tpex";
        } else if (
          dataset === "TaiwanStockHoldingSharesPer" &&
          !process.env.FINMIND_TOKEN
        ) {
          items = await tdccDistribution(r.symbol);
          source = "tdcc";
          const dates = items.map((r) => r.date).sort();
          start = dates[0] ?? end;
          windowEnd = dates.at(-1) ?? end;
        } else if (dataset === "TaiwanStockActiveETFHolding") {
          items = await etfHoldings(provider, r.symbol, end);
          start = maxDate("2025-05-05", start);
          codes = (process.env.ETF_WATCHLIST ?? "")
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean);
        } else if (dataset === "TaiwanStockTradingDailyReport") {
          start = windowEnd = (await tradingRange(end, 1)).end;
          items = await provider.branches(r.symbol, start);
        } else
          items = await provider.get(dataset, {
            data_id: r.symbol,
            start_date: start,
            end_date: end,
          });
        if (r.kind === "equity" && dataset !== "CompanyProfile") {
          const previous =
            (await snapshots(r.market, r.symbol, now(), [dataset]))[0]?.data ??
            [];
          items = replaceObservationWindow(
            previous,
            items,
            start,
            windowEnd,
            codes,
          );
        }
        signal?.throwIfAborted();
        const saved = await saveSnapshot(
          r.market,
          r.symbol,
          dataset,
          items,
          source,
        );
        statuses[dataset] = {
          status: items.length ? "success" : "no_data",
          rows: items.length,
          revision: saved.revision,
        };
      } catch {
        signal?.throwIfAborted();
        statuses[dataset] = {
          status: r.kind === "equity" ? "source_error" : "failed",
          message:
            "來源無法取得；請檢查權限、配額、網路或資料品質。未補入推估數字。",
        };
      }
    }
    await progress(id, { datasets: statuses });
  }
  await finish(
    id,
    r.kind === "equity"
      ? Object.values(statuses).some((s) => s.status === "source_error")
        ? "quality_warning"
        : "success"
      : Object.values(statuses).every((s) => s.status === "success")
        ? "success"
        : "quality_warning",
    { datasets: statuses },
  );
}
export function watchlist() {
  return [
    ...new Map(
      (process.env.WATCHLIST ?? "TWSE:2330,TWSE:0050,TPEX:6488")
        .split(",")
        .filter(Boolean)
        .map((s) => {
          const [market, symbol] = s.trim().split(":");
          stock(market, symbol);
          return [market + ":" + symbol, { market, symbol }];
        }),
    ).values(),
  ];
}
export async function enqueueWatchlist(
  start = null,
  end = addDays(taipeiDay(), -1),
) {
  const ids = [];
  validDate(end);
  if (end >= taipeiDay()) fail("日線更新截止需早於今日");
  for (const item of watchlist()) {
    for (const basis of process.env.ENABLE_ADJUSTED === "true"
      ? ["raw", "adjusted"]
      : ["raw"]) {
      const latest = (
        await rows(
          "SELECT max(trade_date) AS day FROM bars WHERE market=$1 AND symbol=$2 AND source='finmind' AND timeframe='1d' AND price_basis=$3",
          [item.market, item.symbol, basis],
        )
      )[0]?.day;
      ids.push(
        (
          await enqueue(
            "history",
            {
              ...item,
              start:
                start ??
                (latest
                  ? addDays(latest, -10)
                  : (process.env.BACKFILL_START ?? "2021-01-01")),
              end,
              price_basis: basis,
              warmup_days: 420,
              timeframe: "1d",
            },
            true,
            { warmup: false, priority: 0 },
          )
        ).job_id,
      );
    }
    ids.push(
      (await enqueue("fundamentals", item, true, { priority: 0 })).job_id,
    );
  }
  return ids;
}
export async function waitForJobs(ids, signal) {
  while (!signal?.aborted) {
    const jobs = await rows(
      "SELECT id,status FROM job_runs WHERE id=ANY($1::int[])",
      [ids],
    );
    if (jobs.length !== ids.length) fail("背景工作遺失");
    if (jobs.every((j) => !["queued", "running"].includes(j.status))) {
      if (jobs.some((j) => j.status === "failed"))
        fail("部分背景工作失敗，請查看 /api/jobs");
      console.log(
        "Completed jobs:",
        jobs.map((j) => `${j.id}:${j.status}`).join(", "),
      );
      return;
    }
    await sleep(1000);
  }
  fail("工作等待已中止");
}
// Session-level lock prevents concurrent consumers from defeating the shared source rate limit.
export async function runWorker({
  signal,
  schedule = false,
  once = false,
  provider = new FinMind(fetch, { signal }),
} = {}) {
  const client = await pool.connect();
  let lastSchedule = 0,
    locked = false;
  try {
    while (!signal?.aborted) {
      if (!locked) {
        locked = (
          await client.query(
            "SELECT pg_try_advisory_lock(hashtext(current_schema()),78241006) AS locked",
          )
        ).rows[0].locked;
        if (!locked) {
          if (once) return;
          await sleep(2000);
          continue;
        }
        // Retired processes cannot resume jobs without a Node payload.
        // Keep their evidence and report interruption instead of leaving a permanent "running" state.
        await client.query(
          "UPDATE job_runs SET status='failed',finished_at=now(),details=details::jsonb||jsonb_build_object('message','切換前背景工作已中斷，請重新載入區間') WHERE status IN ('queued','running') AND payload->>'kind' IS NULL AND (name LIKE 'ondemand:%' OR name LIKE 'fundamentals:%' OR name LIKE 'equity:%' OR name LIKE 'finmind:%')",
        );
        await client.query(
          "UPDATE job_runs SET status=CASE WHEN attempts<3 THEN 'queued' ELSE 'failed' END,finished_at=CASE WHEN attempts<3 THEN NULL ELSE now() END WHERE status='running' AND payload->>'kind' IS NOT NULL",
        );
      }
      if (schedule && Date.now() - lastSchedule > 6 * 3600000) {
        try {
          await enqueueWatchlist();
          lastSchedule = Date.now();
        } catch {
          console.error("Watchlist enqueue failed; retry in one minute");
          lastSchedule = Date.now() - 6 * 3600000 + 60000;
        }
      }
      const job = await transaction(async (c) => {
        const j = (
          await c.query(
            "SELECT * FROM job_runs WHERE status='queued' AND payload->>'kind' IS NOT NULL ORDER BY priority DESC,id FOR UPDATE SKIP LOCKED LIMIT 1",
          )
        ).rows[0];
        if (!j) return null;
        await c.query(
          "UPDATE job_runs SET status='running',heartbeat_at=now(),attempts=attempts+1 WHERE id=$1",
          [j.id],
        );
        return j;
      });
      if (!job) {
        if (once) return;
        await sleep(1000);
        continue;
      }
      const heartbeat = setInterval(
        () =>
          query("UPDATE job_runs SET heartbeat_at=now() WHERE id=$1", [
            job.id,
          ]).catch(() => {}),
        30000,
      );
      try {
        await executeJob(job, provider, { signal });
      } catch {
        if (signal?.aborted)
          await query(
            "UPDATE job_runs SET status='queued',finished_at=NULL,attempts=GREATEST(attempts-1,0),details=details::jsonb||jsonb_build_object('message','服務停止，等待恢復') WHERE id=$1",
            [job.id],
          );
        else
          await finish(job.id, "failed", {
            message: "背景工作無法完成，請檢查來源與服務日誌",
          });
      } finally {
        clearInterval(heartbeat);
      }
    }
  } finally {
    if (locked)
      await client.query(
        "SELECT pg_advisory_unlock(hashtext(current_schema()),78241006)",
      );
    client.release();
  }
}
