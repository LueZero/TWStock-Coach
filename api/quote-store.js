import { rows } from "./db.js";

export async function saveQuote(client, data) {
  const old = (
    await client.query(
      "SELECT * FROM quote_snapshots WHERE market=$1 AND symbol=$2 AND source_time=$3 FOR UPDATE",
      [data.market, data.symbol, data.source_time],
    )
  ).rows[0];
  if (old) {
    const changed = (
      await client.query(
        "SELECT ($1::jsonb-'received_at') IS DISTINCT FROM ($2::jsonb-'received_at') AS changed",
        [JSON.stringify(old.data), JSON.stringify(data)],
      )
    ).rows[0].changed;
    if (!changed) return; // Re-observation must not erase first availability.
    await client.query(
      "INSERT INTO quote_revisions(snapshot_id,replaced_at,snapshot) VALUES($1,$2,$3)",
      [old.id, data.received_at, JSON.stringify(old)],
    );
    await client.query(
      "UPDATE quote_snapshots SET received_at=$2,data=$3 WHERE id=$1",
      [old.id, data.received_at, JSON.stringify(data)],
    );
  } else
    await client.query(
      "INSERT INTO quote_snapshots(market,symbol,source_time,trade_date,received_at,data) VALUES($1,$2,$3,$4,$5,$6)",
      [
        data.market,
        data.symbol,
        data.source_time,
        data.trade_date,
        data.received_at,
        JSON.stringify(data),
      ],
    );
}

export async function quoteAt(market, symbol, cutoff, read = rows) {
  return (
    await read(
      `SELECT id,source_time,received_at,data FROM (
    SELECT id,source_time,received_at,data::jsonb AS data FROM quote_snapshots
      WHERE market=$1 AND symbol=$2 AND received_at<=$3 AND source_time<=$3
    UNION ALL
    SELECT snapshot_id AS id,(snapshot->>'source_time')::timestamptz,
      (snapshot->>'received_at')::timestamptz,snapshot->'data' AS data FROM quote_revisions
      WHERE snapshot->>'market'=$1 AND snapshot->>'symbol'=$2
        AND (snapshot->>'received_at')::timestamptz<=$3 AND (snapshot->>'source_time')::timestamptz<=$3
  ) versions ORDER BY source_time DESC,received_at DESC LIMIT 1`,
      [market, symbol, cutoff],
    )
  )[0];
}
