import { getQuote } from "./market.js";
import { marketStatus, tradingRange } from "./trading.js";
import { barsResource } from "./direct-data.js";
import { addDays } from "./lib.js";
export async function refreshLatestStock(market, symbol) {
  const status = await marketStatus(),
    end = (await tradingRange(status.daily_source_end, 1)).end;
  const quote = await getQuote(market, symbol)
    .then((q) => ({ date: q.trade_date, state: q.state }))
    .catch(() => ({ state: "unavailable" }));
  const entry = barsResource(market, symbol, {
    start: addDays(end, -660),
    end,
    price_basis: "raw",
    timeframe: "1d",
  });
  let timer;
  await Promise.race([
    entry.promise,
    new Promise((resolve) => {
      timer = setTimeout(resolve, 20000);
    }),
  ]);
  clearTimeout(timer);
  const latest = entry.value?.bars.at(-1)?.trade_date;
  return {
    status: latest && latest >= end ? "up_to_date" : "stale",
    data_date: latest || null,
    expected_day: end,
    quote,
    provider_status: entry.pending
      ? "running"
      : entry.error
        ? "failed"
        : "success",
    storage: "memory",
    database_used: false,
    note: entry.error || "來源API直取；沒有DB行情快照。",
  };
}
