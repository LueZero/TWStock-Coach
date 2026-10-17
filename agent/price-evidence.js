import { legalPrice } from "../api/report-conditions.js";

// Keep price dimensions separate from volume, ratios, IDs and personal budgets.
export function stockPriceValues(
  report,
  bars = [],
  { executable = false } = {},
) {
  const result = new Set();
  const add = (v) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return;
    if (executable) {
      for (const direction of ["nearest", "up", "down"]) {
        const price = legalPrice(
          v,
          report.meta?.asset || report.asset || "stock",
          direction,
        );
        if (price > 0) result.add(String(price));
      }
      return;
    }
    result.add(String(v));
    result.add(String(Number(v.toFixed(2))));
    result.add(String(Number(v.toFixed(4))));
  };
  const metrics = (data) => {
    for (const [k, v] of Object.entries(data || {}))
      if (/^ma\d+$|^bb_(upper|lower)$|^prior_high\d+$/.test(k)) add(v);
  };
  const priceRow = (row) => {
    for (const k of [
      "open",
      "high",
      "low",
      "close",
      "last_price",
      "previous_close",
    ])
      add(row?.[k]);
    metrics(row);
  };
  const scenarios = (items) => {
    for (const s of items || [])
      for (const k of ["trigger", "stop", "target"]) add(s[k]);
  };
  metrics(report.metrics);
  scenarios(report.scenarios);
  [...bars, ...(report.chart_bars || [])].forEach(priceRow);
  for (const e of report.evidence || []) {
    const id = e.original_id || e.id || "";
    if (
      /(?:^|:)price:last$|(?:^|:)technical:(?:ma\d+|bb_upper|bb_lower|prior_high\d+)$/.test(
        id,
      )
    )
      add(e.value);
    if (/(?:^|:)quote:snapshot$/.test(id)) {
      priceRow(e.data);
      (e.rows || []).forEach(priceRow);
    }
    // Tool audit envelopes: only typed stock data, never arbitrary numeric cells.
    const data = e.data || {};
    metrics(data.metrics);
    scenarios(data.scenarios);
    (data.bars?.rows || []).forEach(priceRow);
    if (data.price_basis === "raw" || data.final_bars_only === true)
      priceRow(data);
    if (e.category === "technical") priceRow(data);
    if (typeof data.price === "number") add(data.price);
    // Successful calculator inputs have already been checked against source prices.
    if (data.formula === "毛損益＝（賣價－買價）×股數") {
      add(data.buy_price);
      add(data.sell_price);
    }
  }
  return result;
}
