import { buildSnapshot, validateAssistantInput } from "./research-packet.js";
import {
  directBars,
  directFinancial,
  directEquity,
  directPeers,
} from "./direct-data.js";
import { getCatalog, getQuote } from "./market.js";
import { memorySnapshots } from "./market-board.js";
import { addDays, taipeiDay, fail } from "./lib.js";
export async function directResearch(body) {
  const q = validateAssistantInput(body);
  if (q.mode === "historical" && Date.now() - Date.parse(q.as_of) > 15 * 60000)
    fail(
      "純來源API模式無法重建歷史當時可得資料版本；可查歷史價格區間，但不提供DB修訂快照。",
      422,
    );
  const end = taipeiDay(),
    start = q.start;
  const bars = await directBars(q.market, q.symbol, {
    start: addDays(start, -480),
    end,
    price_basis: "raw",
    timeframe: "1d",
  });
  const quote = await getQuote(q.market, q.symbol).catch(() => null);
  const input = await buildSnapshot(
    { ...body, mode: "latest" },
    {
      instrument: async (m, s) =>
        (await getCatalog()).find((i) => i.market === m && i.symbol === s),
      bars: async () => bars,
      financial: async (m, s) => (await directFinancial(m, s)).data,
      equity: async (m, s, a, b) => (await directEquity(m, s, a, b)).data,
      peers: async (m, s, r) => directPeers(m, s, r, "latest", "common", null),
      external: async () =>
        memorySnapshots().filter(
          (s) =>
            s.source_key.startsWith("quotes:") ||
            s.source_key.startsWith("index-month:") ||
            s.source_key.startsWith("market-chips:") ||
            s.source_key.includes(`:${q.market}:${q.symbol}:`),
        ),
      quote: async () =>
        quote
          ? {
              id: null,
              data: quote,
              source_time: quote.source_time,
              received_at: quote.received_at,
            }
          : null,
    },
  );
  input.database_used = false;
  input.storage = "memory";
  input.requested_as_of = q.as_of;
  input.point_in_time = false;
  input.quality.push({
    severity: "warning",
    label:
      "來源API直接取得，無歷史DB快照；財務與籌碼可能仍在來源查詢中，各項以實際來源時間為準。",
  });
  return input;
}
