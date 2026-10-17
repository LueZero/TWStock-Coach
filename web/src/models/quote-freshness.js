export function observedQuote(quote, stamp = Date.now()) {
  if (!quote) return null;
  const time = new Date(stamp).getTime(),
    source = Date.parse(quote.source_time);
  const local = new Date(time + 8 * 3600000),
    today = local.toISOString().slice(0, 10);
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const age = Number.isFinite(source)
    ? Math.max(0, (time - source) / 1000)
    : null;
  const during = minute >= 540 && minute < 810;
  const state =
    quote.state === "unavailable" || age == null
      ? "unavailable"
      : quote.trade_date < today
        ? "previous_session"
        : during && age > 120
          ? "delayed"
          : during
            ? "snapshot"
            : "after_close";
  return {
    ...quote,
    state,
    age_seconds: age,
    state_label: {
      unavailable: "來源暫時無法更新，顯示上次快照",
      previous_session: "最近交易日資料（不是今日報價）",
      delayed: "行情已延遲",
      snapshot: "盤中公開快照",
      after_close: "盤後公開快照",
    }[state],
  };
}
