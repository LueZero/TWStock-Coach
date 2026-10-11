import { transaction, normalize, rows } from "./db.js";
import { calculate, advise, METRICS, VERSION } from "./indicators.js";
import {
  stock,
  validStamp,
  validDate,
  taipeiDay,
  integer,
  finiteNumber,
  fail,
  now,
} from "./lib.js";
export const SERIES = [
  "market",
  "symbol",
  "session",
  "timeframe",
  "price_basis",
];
const VALUES = [
  "open",
  "high",
  "low",
  "close",
  "volume",
  "source",
  "source_volume_unit",
  "source_time",
  "is_final",
];
export function validateBar(input) {
  const b = {
    price_basis: "raw",
    source_volume_unit: "shares",
    payload: {},
    ...input,
  };
  stock(b.market, b.symbol);
  if (
    !["regular", "intraday_odd", "afterhours_odd", "daily_aggregate"].includes(
      b.session,
    ) ||
    !["1d", "1m"].includes(b.timeframe) ||
    !["raw", "adjusted"].includes(b.price_basis) ||
    !["shares", "lots"].includes(b.source_volume_unit)
  )
    fail("K線分類不符");
  if (
    typeof b.timestamp === "string" &&
    /\.\d*[1-9]\d*(Z|[+-]\d{2}:\d{2})$/.test(b.timestamp)
  )
    fail("K線時間需對齊，不接受非零小數秒");
  b.timestamp = validStamp(b.timestamp);
  b.source_time = validStamp(b.source_time);
  validDate(b.trade_date);
  if (taipeiDay(b.timestamp) !== b.trade_date)
    fail("交易日期與Asia/Taipei時間戳不一致");
  for (const k of ["open", "high", "low", "close"])
    b[k] = finiteNumber(b[k], Number.MIN_VALUE, Number.MAX_VALUE, k);
  integer(b.volume, 0, Number.MAX_SAFE_INTEGER, "股數");
  if (
    typeof b.is_final !== "boolean" ||
    typeof b.source !== "string" ||
    !b.source.length ||
    b.source.length > 64 ||
    !b.payload ||
    typeof b.payload !== "object" ||
    Array.isArray(b.payload)
  )
    fail("來源或K線完成狀態不符");
  if (
    b.high < Math.max(b.open, b.close) ||
    b.low > Math.min(b.open, b.close) ||
    b.low > b.high
  )
    fail("invalid OHLC bounds");
  const stamp = Date.parse(b.timestamp);
  if (stamp > Date.now()) fail("future bars are not allowed");
  const clock = new Date(stamp + 8 * 3600000).toISOString().slice(11, 23);
  if (b.timeframe === "1d" && clock !== "13:30:00.000")
    fail("daily timestamp must be 13:30 Asia/Taipei");
  if (b.timeframe === "1m" && stamp % 60000)
    fail("minute bars require aligned minute timestamps");
  if (b.is_final && b.timeframe === "1m" && stamp + 60000 > Date.now())
    fail("cannot finalize a minute that has not ended");
  return b;
}
export function serialize(bar, analysis = null) {
  return {
    ...bar,
    volume_unit: "shares",
    analysis: analysis ? { ...analysis, validation: "not_backtested" } : null,
  };
}
export async function ingest(inputs) {
  const bars = inputs.map(validateBar);
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(78241001)");
    let changed = 0,
      unchanged = 0,
      stale_ignored = 0;
    const groups = new Map();
    for (const b of bars) {
      const key = SERIES.map((k) => b[k]),
        old = normalize(
          (
            await client.query(
              "SELECT * FROM bars WHERE " +
                SERIES.map((k, i) => k + "=$" + (i + 1)).join(" AND ") +
                " AND timestamp=$6",
              [...key, b.timestamp],
            )
          ).rows,
        )[0];
      if (old) {
        if (old.source !== b.source)
          fail(
            "source conflict: reconcile explicitly; automatic source switching is disabled",
            409,
          );
        if (
          Date.parse(b.source_time) < Date.parse(old.source_time) ||
          (old.is_final && !b.is_final)
        ) {
          stale_ignored++;
          continue;
        }
        if (
          VALUES.every((k) =>
            k === "source_time"
              ? Date.parse(old[k]) === Date.parse(b[k])
              : old[k] === b[k],
          )
        ) {
          unchanged++;
          continue;
        }
        await client.query(
          "INSERT INTO bar_revisions(bar_id,revision,replaced_at,snapshot) VALUES($1,$2,now(),$3)",
          [
            old.id,
            old.revision,
            JSON.stringify(
              Object.fromEntries(
                [
                  ...SERIES,
                  ...VALUES,
                  "timestamp",
                  "trade_date",
                  "received_at",
                  "revision",
                  "payload",
                ].map((k) => [k, old[k]]),
              ),
            ),
          ],
        );
        const fields = [
          ...SERIES,
          ...VALUES,
          "timestamp",
          "trade_date",
          "payload",
        ];
        await client.query(
          "UPDATE bars SET " +
            fields.map((k, i) => k + "=$" + (i + 1)).join(",") +
            ",received_at=now(),revision=revision+1 WHERE id=$" +
            (fields.length + 1),
          [
            ...fields.map((k) =>
              k === "payload" ? JSON.stringify(b[k]) : b[k],
            ),
            old.id,
          ],
        );
      } else {
        const fields = [
          ...SERIES,
          ...VALUES,
          "timestamp",
          "trade_date",
          "payload",
        ];
        await client.query(
          "INSERT INTO bars(" +
            fields.join(",") +
            ",received_at,revision) VALUES(" +
            fields.map((_, i) => "$" + (i + 1)).join(",") +
            ",now(),1)",
          fields.map((k) => (k === "payload" ? JSON.stringify(b[k]) : b[k])),
        );
      }
      changed++;
      groups.set(key.join(":"), key);
    }
    for (const key of groups.values()) await recompute(client, key);
    return { changed, unchanged, stale_ignored };
  });
}
export async function recompute(client, key) {
  const bars = normalize(
    (
      await client.query(
        "SELECT * FROM bars WHERE " +
          SERIES.map((k, i) => k + "=$" + (i + 1)).join(" AND ") +
          " ORDER BY timestamp",
        key,
      )
    ).rows,
  );
  await client.query("DELETE FROM analysis WHERE bar_id=ANY($1::int[])", [
    bars.map((b) => b.id),
  ]);
  const final = bars.filter((b) => b.is_final),
    computed = calculate(final);
  for (let i = 0; i < final.length; i++) {
    const b = final[i],
      a = computed[i],
      [status, advice] = advise(a, b.price_basis),
      fields = [
        "bar_id",
        "bar_revision",
        ...METRICS,
        "status",
        "advice",
        "version",
        "computed_at",
      ];
    await client.query(
      "INSERT INTO analysis(" +
        fields.join(",") +
        ") VALUES(" +
        fields.map((_, i) => "$" + (i + 1)).join(",") +
        ")",
      [
        b.id,
        b.revision,
        ...METRICS.map((k) => a[k] ?? null),
        status,
        advice,
        VERSION,
        now(),
      ],
    );
  }
}
export async function barRows(
  market,
  symbol,
  {
    timeframe = "1d",
    session = "daily_aggregate",
    price_basis = "raw",
    start = null,
    end = null,
    limit = 5000,
    analysis = false,
  } = {},
) {
  const args = [market, symbol, timeframe, session, price_basis],
    where = [
      "b.market=$1",
      "b.symbol=$2",
      "b.timeframe=$3",
      "b.session=$4",
      "b.price_basis=$5",
    ];
  if (start) {
    args.push(start);
    where.push("b.trade_date>=$" + args.length);
  }
  if (end) {
    args.push(end);
    where.push("b.trade_date<=$" + args.length);
  }
  args.push(limit);
  const data = await rows(
    "SELECT b.*" +
      (analysis ? ",row_to_json(a) AS analysis_data" : "") +
      " FROM bars b " +
      (analysis
        ? "LEFT JOIN analysis a ON a.bar_id=b.id AND a.bar_revision=b.revision"
        : "") +
      " WHERE " +
      where.join(" AND ") +
      " ORDER BY b.timestamp DESC LIMIT $" +
      args.length,
    args,
  );
  return data
    .reverse()
    .map(({ analysis_data, ...b }) => serialize(b, analysis_data));
}
