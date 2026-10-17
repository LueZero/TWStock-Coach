import { calculate, advise, METRICS, MA_PERIODS } from "./indicators.js";
import { annotateTechnicalRows } from "./technical-events.js";
import { addDays, taipeiDay } from "./lib.js";
export const RESOLUTIONS = [
  "1m",
  "5m",
  "15m",
  "30m",
  "60m",
  "120m",
  "1d",
  "1w",
  "1mo",
];
export function aggregate(
  rows,
  resolution,
  now = new Date(),
  periods = MA_PERIODS,
) {
  const groups = new Map();
  for (const row of rows) {
    const stamp = new Date(row.timestamp),
      day = taipeiDay(stamp),
      opening =
        row.session === "afterhours_odd"
          ? "14:30"
          : row.session === "intraday_odd"
            ? "09:10"
            : "09:00",
      anchor = Date.parse(day + "T" + opening + ":00+08:00");
    let start = stamp.getTime(),
      stop = start,
      key = day;
    if (resolution.endsWith("m") && resolution !== "1mo") {
      const minutes = Number(resolution.slice(0, -1));
      const duration =
        row.session === "afterhours_odd"
          ? 0
          : row.session === "intraday_odd"
            ? 260
            : 270;
      let offset = Math.floor((start - anchor) / 60000);
      if (offset < 0 || offset > duration) continue;
      if (minutes > 1 && duration > 0) offset = Math.min(offset, duration - 1);
      start = anchor + Math.floor(offset / minutes) * minutes * 60000;
      stop = Math.min(
        start + minutes * 60000,
        anchor +
          (duration === 0 ? 1 : minutes === 1 ? duration + 1 : duration) *
            60000,
      );
      key = new Date(start).toISOString();
    } else if (resolution === "1w") {
      const weekDay = (new Date(day).getUTCDay() + 6) % 7;
      key = addDays(day, -weekDay);
      start = Date.parse(key + "T00:00:00+08:00");
      stop = start + 7 * 86400000;
    } else if (resolution === "1mo") {
      key = day.slice(0, 7) + "-01";
      start = Date.parse(key + "T00:00:00+08:00");
      stop =
        Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 1) -
        8 * 3600000;
    }
    if (!groups.has(key))
      groups.set(key, {
        ...row,
        timestamp: new Date(start).toISOString(),
        end_time: new Date(stop).toISOString(),
        analysis: null,
        component_count: 0,
        is_final: true,
        source_revisions: [],
        sources: [],
        period_start: taipeiDay(start),
      });
    const bar = groups.get(key);
    bar.high = Math.max(bar.high, row.high);
    bar.low = Math.min(bar.low, row.low);
    bar.close = row.close;
    bar.trade_date = row.trade_date;
    if (bar.component_count) bar.volume += row.volume;
    bar.component_count++;
    bar.is_final =
      bar.is_final && row.is_final && stop <= new Date(now).getTime();
    bar.source_revisions.push({
      id: row.id ?? null,
      revision: row.revision ?? null,
    });
    if (!bar.sources.includes(row.source ?? null))
      bar.sources.push(row.source ?? null);
    for (const f of ["source_time", "received_at"])
      if (row[f] && (!bar[f] || Date.parse(row[f]) > Date.parse(bar[f])))
        bar[f] = row[f];
  }
  const result = [...groups.values()],
    final = result.filter((r) => r.is_final),
    computed = calculate(final);
  final.forEach((bar, i) => {
    const [status, advice] = advise(computed[i], bar.price_basis);
    bar.analysis = Object.fromEntries(
      [...METRICS, "prior_high20", "prior_low20"].map((k) => [
        k,
        computed[i][k] ?? null,
      ]),
    );
    Object.assign(bar.analysis, { status, advice });
    for (const p of periods)
      bar.analysis["ma" + p] =
        i >= p - 1
          ? final.slice(i - p + 1, i + 1).reduce((a, r) => a + r.close, 0) / p
          : null;
  });
  return annotateTechnicalRows(
    result.map((r) => ({ ...r, ...r.analysis })),
  ).map(({ technical_state, technical_events, signals }, i) => ({
    ...result[i],
    technical_state,
    technical_events,
    signals,
  }));
}
