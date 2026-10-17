import { rows } from "./db.js";
import { addDays } from "./lib.js";

// Match daily chart warmup (MA240 * 2 calendar days), then keep the entire
// requested interval. A fixed latest-N cap silently truncates long-range MA data.
export async function reportBars(q, read = rows) {
  const data = await read(
    `SELECT data FROM (
    SELECT DISTINCT ON (bar_id) bar_id,revision,data FROM (
      SELECT id AS bar_id,revision,to_jsonb(b) AS data FROM bars b
       WHERE market=$1 AND symbol=$2 AND session='daily_aggregate' AND timeframe='1d' AND price_basis='raw' AND received_at<=$3 AND source_time<=$3 AND trade_date BETWEEN $5 AND $4
      UNION ALL
      SELECT r.bar_id,r.revision,r.snapshot::jsonb AS data FROM bar_revisions r JOIN bars b ON b.id=r.bar_id
       WHERE b.market=$1 AND b.symbol=$2 AND b.session='daily_aggregate' AND b.timeframe='1d' AND b.price_basis='raw'
        AND (r.snapshot->>'received_at')::timestamptz<=$3 AND (r.snapshot->>'source_time')::timestamptz<=$3 AND (r.snapshot->>'trade_date')::date BETWEEN $5 AND $4
    ) candidates ORDER BY bar_id,revision DESC
  ) versions ORDER BY (data->>'timestamp')::timestamptz`,
    [q.market, q.symbol, q.as_of, q.end, addDays(q.start, -480)],
  );
  return data.map((r) => r.data).filter((b) => b.is_final);
}
