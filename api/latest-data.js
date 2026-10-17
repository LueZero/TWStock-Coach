import { rows } from "./db.js";
import { enqueue } from "./jobs.js";
import { getQuote } from "./market.js";
import { marketStatus, tradingRange } from "./trading.js";
import { addDays, sleep } from "./lib.js";

// Refresh before capturing a latest report cutoff; historical reports never call this.
export async function refreshLatestStock(market, symbol) {
  const status = await marketStatus();
  const end = (await tradingRange(status.daily_source_end, 1)).end;
  const quote = await getQuote(market, symbol)
    .then((q) => ({ date: q.trade_date, state: q.state }))
    .catch(() => ({ state: "unavailable" }));
  const latest = (
    await rows(
      "SELECT max(trade_date) AS date FROM bars WHERE market=$1 AND symbol=$2 AND session='daily_aggregate' AND timeframe='1d' AND price_basis='raw' AND is_final",
      [market, symbol],
    )
  )[0]?.date;
  if (latest && latest >= end)
    return {
      status: "up_to_date",
      expected_day: end,
      data_date: latest,
      quote,
    };
  const job = await enqueue(
    "history",
    {
      market,
      symbol,
      start: addDays(end, -10),
      end,
      price_basis: "raw",
      timeframe: "1d",
      warmup_days: 420,
    },
    false,
    { warmup: false },
  );
  const deadline = Date.now() + 20000;
  let result = job;
  while (
    ["queued", "running"].includes(result.status) &&
    Date.now() < deadline
  ) {
    await sleep(500);
    result = (
      await rows("SELECT status,details FROM job_runs WHERE id=$1", [
        job.job_id,
      ])
    )[0] || { status: "failed" };
  }
  const current = (
    await rows(
      "SELECT max(trade_date) AS date FROM bars WHERE market=$1 AND symbol=$2 AND session='daily_aggregate' AND timeframe='1d' AND price_basis='raw' AND is_final",
      [market, symbol],
    )
  )[0]?.date;
  return {
    status: current && current >= end ? "up_to_date" : "stale",
    provider_status: result.status,
    data_date: current || null,
    job_id: job.job_id,
    expected_day: end,
    quote,
    note: ["queued", "running"].includes(result.status)
      ? "日K更新仍在排程中，資料日期可能落後；不把舊價格稱作今日。"
      : result.details?.message,
  };
}
