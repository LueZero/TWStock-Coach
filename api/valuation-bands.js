// Source-multiple conversion, not reconstructed EPS/BVPS or an intrinsic value model.
import { num } from "./lib.js";
const percentile = (values, q) => {
  const a = [...values].sort((x, y) => x - y),
    i = (a.length - 1) * q,
    lo = Math.floor(i);
  return a[lo] + (a[Math.ceil(i)] - a[lo]) * (i - lo);
};
export function valuationBands(
  bars,
  ratios,
  field,
  { window = 252, minSamples = 60 } = {},
) {
  if (!["PER", "PBR"].includes(field)) throw Error("不支援的估值倍數");
  const by = new Map(),
    counts = new Map();
  for (const r of ratios) {
    counts.set(r.date, (counts.get(r.date) || 0) + 1);
    by.set(r.date, num(r[field]));
  }
  const past = [],
    rows = [];
  const prices = [...bars]
    .filter((b) => b.is_final !== false)
    .sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  for (const bar of prices) {
    const date = bar.trade_date,
      multiple = by.get(date),
      close = num(bar.close);
    if (counts.get(date) !== 1 || !(multiple > 0) || !(close > 0)) continue;
    past.push(multiple);
    if (past.length > window) past.shift();
    if (past.length < minSamples) continue;
    const base = close / multiple;
    rows.push({
      date,
      close,
      multiple,
      samples: past.length,
      ...Object.fromEntries(
        [0.2, 0.4, 0.6, 0.8].map((q) => [
          `q${q * 100}`,
          base * percentile(past, q),
        ]),
      ),
    });
  }
  return {
    rows,
    window,
    min_samples: minSamples,
    method: "same_day_source_multiple_conversion",
    price_basis: "raw",
    note: "以每日原始收盤價÷當日來源倍數作換算基準，乘當日及之前最近252筆有效倍數的20／40／60／80分位數；至少60筆才顯示。這不是重新核對EPS或每股淨值的標準估值河流圖，也不是合理價、含息報酬或買賣訊號。來源歷史可能已修訂，不能重建當時公告版本。",
  };
}
