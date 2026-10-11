import { fetchJSON, addDays, taipeiDay, fail } from "./lib.js";
const URL = "https://www.twse.com.tw/rwd/zh/holidaySchedule/holidaySchedule",
  fallback =
    "01-01 02-12 02-13 02-15 02-16 02-17 02-18 02-19 02-20 02-27 02-28 04-03 04-04 04-05 04-06 05-01 06-19 09-25 09-28 10-09 10-10 10-25 10-26 12-25".split(
      " ",
    ),
  cache = new Map();
export async function calendar(year, fetcher = fetchJSON) {
  const stored = cache.get(year);
  if (stored && Date.now() - stored.at < 3600000) return stored.value;
  let value;
  try {
    const body = await fetcher(
      `${URL}?response=json&queryYear=${year - 1911}`,
      8000,
    );
    if (
      body.stat !== "ok" ||
      Number(body.queryYear) !== year ||
      !body.data?.length
    )
      throw Error("Calendar unavailable");
    value = {
      closed: Object.fromEntries(
        body.data
          .filter(
            (r) => !r[1].includes("開始交易") && !r[1].includes("最後交易"),
          )
          .map((r) => [r[0], r[1]]),
      ),
      source: "twse",
      known: true,
    };
  } catch {
    value =
      year === 2026
        ? {
            closed: Object.fromEntries(
              fallback.map((d) => ["2026-" + d, "公告休市日"]),
            ),
            source: "verified_2026_snapshot",
            known: true,
          }
        : { closed: {}, source: "unavailable", known: false };
  }
  cache.set(year, { at: Date.now(), value });
  return value;
}
export function clearCalendarCache() {
  cache.clear();
}
export async function marketStatus(stamp = new Date()) {
  const local = new Date(new Date(stamp).getTime() + 8 * 3600000),
    day = local.toISOString().slice(0, 10),
    c = await calendar(local.getUTCFullYear()),
    weekend = [0, 6].includes(local.getUTCDay()),
    trading = c.known && !weekend && !(day in c.closed),
    minute = local.getUTCHours() * 60 + local.getUTCMinutes(),
    allowed = trading && minute >= 540 && minute < 810;
  return {
    date: day,
    server_time: new Date(stamp).toISOString(),
    timezone: "Asia/Taipei",
    is_trading_day: trading,
    monitor_allowed: allowed,
    reason: !c.known
      ? "交易日曆無法確認，暫停自動監控"
      : c.closed[day] ||
        (weekend
          ? "週末休市"
          : allowed
            ? "一般整股交易時段"
            : "非一般整股交易時段"),
    calendar_source: c.source,
    note: "年度日曆未包含臨時休市；盤中仍須確認行情日期與新鮮度。",
  };
}
export async function tradingRange(end, sessions) {
  const dates = [],
    sources = {};
  let cursor = end;
  for (let n = 0; n < 800; n++, cursor = addDays(cursor, -1)) {
    const year = Number(cursor.slice(0, 4));
    sources[year] ??= await calendar(year);
    if (!sources[year].known)
      fail(`${year} 年交易日曆無法確認，請改用自訂日期。`, 503);
    if (
      ![0, 6].includes(new Date(cursor + "T00:00:00Z").getUTCDay()) &&
      !(cursor in sources[year].closed)
    ) {
      dates.push(cursor);
      if (dates.length === sessions)
        return {
          start: dates.at(-1),
          end: dates[0],
          sessions,
          trading_dates: dates.reverse(),
          calendar_sources: Object.fromEntries(
            Object.entries(sources).map(([y, c]) => [y, c.source]),
          ),
          note: "排除週末與年度公告休市日；臨時休市及個股停牌仍以實際行情為準。",
        };
    }
  }
  fail("交易日範圍過長，請縮小區間。");
}
