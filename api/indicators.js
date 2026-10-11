import { sum, num } from "./lib.js";
export const VERSION = "technical-v1";
export const MA_PERIODS = [5, 10, 20, 60, 120, 240];
export const METRICS = [
  ...MA_PERIODS.map((p) => "ma" + p),
  "rsi14",
  "macd",
  "macd_signal",
  "macd_histogram",
  "atr14",
  "bb_upper",
  "bb_lower",
  "volume_ratio",
  "k",
  "d",
];
export function wilder(samples, period) {
  const output = Array(samples.length).fill(null);
  let count = 0,
    value = 0;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i] == null) continue;
    count++;
    if (count <= period) {
      value += samples[i];
      if (count === period) {
        value /= period;
        output[i] = value;
      }
    } else {
      value = (value * (period - 1) + samples[i]) / period;
      output[i] = value;
    }
  }
  return output;
}
function ema(samples, span) {
  const output = Array(samples.length).fill(null),
    alpha = 2 / (span + 1);
  let value = null,
    count = 0;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i] == null) continue;
    value =
      value == null ? samples[i] : (1 - alpha) * value + alpha * samples[i];
    if (++count >= span) output[i] = value;
  }
  return output;
}
export function calculate(rows) {
  const close = rows.map((r) => r.close),
    gain = [],
    loss = [],
    tr = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i],
      change = i ? close[i] - close[i - 1] : null;
    gain.push(change == null ? null : Math.max(0, change));
    loss.push(change == null ? null : Math.max(0, -change));
    tr.push(
      Math.max(
        r.high - r.low,
        i ? Math.abs(r.high - close[i - 1]) : 0,
        i ? Math.abs(r.low - close[i - 1]) : 0,
      ),
    );
  }
  const gains = wilder(gain, 14),
    losses = wilder(loss, 14),
    atr = wilder(tr, 14),
    fast = ema(close, 12),
    slow = ema(close, 26),
    macd = close.map((_, i) =>
      fast[i] != null && slow[i] != null ? fast[i] - slow[i] : null,
    ),
    signal = ema(macd, 9);
  let k = 50,
    d = 50;
  return rows.map((row, i) => {
    const a = { ...row };
    for (const p of MA_PERIODS)
      a["ma" + p] = i + 1 >= p ? sum(close.slice(i - p + 1, i + 1)) / p : null;
    a.rsi14 =
      gains[i] == null || losses[i] == null
        ? null
        : losses[i] === 0
          ? gains[i] > 0
            ? 100
            : 50
          : 100 - 100 / (1 + gains[i] / losses[i]);
    a.macd = macd[i];
    a.macd_signal = signal[i];
    a.macd_histogram = signal[i] != null ? macd[i] - signal[i] : null;
    a.atr14 = atr[i];
    const sd =
      i >= 19
        ? Math.sqrt(
            sum(close.slice(i - 19, i + 1).map((v) => (v - a.ma20) ** 2)) / 20,
          )
        : null;
    a.bb_upper = sd != null ? a.ma20 + 2 * sd : null;
    a.bb_lower = sd != null ? a.ma20 - 2 * sd : null;
    const meanVolume =
      i >= 20 ? sum(rows.slice(i - 20, i).map((r) => r.volume)) / 20 : null;
    a.volume_ratio = meanVolume > 0 ? row.volume / meanVolume : null;
    a.k = a.d = null;
    if (i >= 8) {
      const window = rows.slice(i - 8, i + 1),
        low = Math.min(...window.map((r) => r.low)),
        high = Math.max(...window.map((r) => r.high)),
        rsv = high === low ? 50 : (100 * (row.close - low)) / (high - low);
      k = (2 / 3) * k + (1 / 3) * rsv;
      d = (2 / 3) * d + (1 / 3) * k;
      a.k = k;
      a.d = d;
    }
    a.prior_high20 =
      i >= 20 ? Math.max(...rows.slice(i - 20, i).map((r) => r.high)) : null;
    return a;
  });
}
export function advise(row, basis) {
  const ma5 = num(row.ma5),
    ma20 = num(row.ma20);
  if (ma5 == null || ma20 == null)
    return ["warming_up", "資料不足 20 根完成 K 線；暫不提供趨勢判讀。"];
  let status = "neutral",
    message = "趨勢未形成一致方向，觀察價格與 MA5、MA20 的相對位置。";
  if (row.close > ma5 && ma5 > ma20) {
    status = "bullish";
    message = "短線趨勢偏強：收盤價 > MA5 > MA20；觀察能否維持 MA20 之上。";
  } else if (row.close < ma5 && ma5 < ma20) {
    status = "bearish";
    message = "短線趨勢偏弱：收盤價 < MA5 < MA20；觀察能否重新站回 MA20。";
  }
  if (
    row.prior_high20 != null &&
    row.volume_ratio != null &&
    row.close > row.prior_high20 &&
    row.volume_ratio >= 1.5
  ) {
    status = "breakout";
    message +=
      " 收盤突破前 20 根最高價，量比至少 1.5；留意突破失敗與成交成本。";
  }
  if (row.rsi14 != null && row.rsi14 >= 70)
    message += " RSI ≥ 70，動能偏熱，留意回檔。";
  else if (row.rsi14 != null && row.rsi14 <= 30)
    message += " RSI ≤ 30，動能偏弱，尚不能據此確認反轉。";
  if (basis === "raw") message += " 使用原始價，除權息或分割可能影響判讀。";
  return [status, message + " 規則尚未經樣本外回測，不代表模型預測。"];
}
