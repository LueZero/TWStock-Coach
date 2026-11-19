import {
  stock,
  validStamp,
  validDate,
  taipeiDay,
  integer,
  finiteNumber,
  fail,
} from "./lib.js";
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
