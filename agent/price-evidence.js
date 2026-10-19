import { legalPrice } from "../api/report-conditions.js";

// Keep price dimensions separate from volume, ratios, IDs and personal budgets.
export function stockPriceValues(
  report,
  bars = [],
  { executable = false } = {},
) {
  const result = new Set();
  const add = (v, asset = report.meta?.asset || report.asset || "stock") => {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return;
    if (executable) {
      for (const direction of ["nearest", "up", "down"]) {
        const price = legalPrice(v, asset, direction);
        if (price > 0) result.add(String(price));
      }
      return;
    }
    result.add(String(v));
    result.add(String(Number(v.toFixed(2))));
    result.add(String(Number(v.toFixed(4))));
  };
  const metrics = (data, asset) => {
    for (const [k, v] of Object.entries(data || {}))
      if (/^ma\d+$|^bb_(upper|lower)$|^prior_(high|low)\d+$/.test(k))
        add(v, asset);
  };
  const priceRow = (row, asset) => {
    for (const k of [
      "open",
      "high",
      "low",
      "close",
      "last_price",
      "previous_close",
    ])
      add(row?.[k], asset);
    metrics(row, asset);
  };
  const scenarios = (items, asset) => {
    for (const s of items || [])
      for (const k of ["trigger", "stop", "target"]) add(s[k], asset);
  };
  metrics(report.metrics);
  scenarios(report.scenarios);
  [...bars, ...(report.chart_bars || [])].forEach((row) => priceRow(row));
  for (const e of report.evidence || []) {
    const id = e.original_id || e.id || "";
    const asset = e.asset || e.data?.meta?.asset;
    if (
      /(?:^|:)price:last$|(?:^|:)technical:(?:ma\d+|bb_upper|bb_lower|prior_(?:high|low)\d+)$/.test(
        id,
      )
    )
      add(e.value, asset);
    if (/(?:^|:)quote:snapshot$/.test(id)) {
      priceRow(e.data, asset);
      (e.rows || []).forEach((row) => priceRow(row, asset));
    }
    // Tool audit envelopes: only typed stock data, never arbitrary numeric cells.
    const data = e.data || {};
    if (data.kind === "official_daily_screen")
      for (const group of data.groups || [])
        for (const row of group.rows || []) add(row.close, row.asset);
    metrics(data.metrics, asset);
    scenarios(data.scenarios, asset);
    (data.bars?.rows || []).forEach((row) => priceRow(row, asset));
    if (data.price_basis === "raw" || data.final_bars_only === true)
      priceRow(data, asset);
    if (e.category === "technical") priceRow(data, asset);
    if (typeof data.price === "number") add(data.price, asset);
    // Successful calculator inputs have already been checked against source prices.
    if (data.formula === "毛損益＝（賣價－買價）×股數") {
      if (data.buy_price_source !== "user_cost") add(data.buy_price, asset);
      add(data.sell_price, asset);
    }
  }
  return result;
}
