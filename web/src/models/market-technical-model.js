// Close-only indicators never invent daily highs/lows for the cash index.
export function closeMetrics(rows) {
  const samples = rows.filter((r) => r.is_final && Number.isFinite(r.close)),
    close = samples.map((r) => r.close);
  const average = (n) =>
    close.length < n ? null : close.slice(-n).reduce((a, b) => a + b, 0) / n;
  let gain = null,
    loss = null;
  for (let i = 14; i < close.length; i++) {
    if (i === 14) {
      gain = 0;
      loss = 0;
      for (let j = 1; j <= 14; j++) {
        const d = close[j] - close[j - 1];
        gain += Math.max(d, 0) / 14;
        loss += Math.max(-d, 0) / 14;
      }
    } else {
      const d = close[i] - close[i - 1];
      gain = (gain * 13 + Math.max(d, 0)) / 14;
      loss = (loss * 13 + Math.max(-d, 0)) / 14;
    }
  }
  let fast = null,
    slow = null,
    signal = null,
    count = 0,
    macd = null;
  for (let i = 0; i < close.length; i++) {
    fast = fast == null ? close[i] : fast + (2 / 13) * (close[i] - fast);
    slow = slow == null ? close[i] : slow + (2 / 27) * (close[i] - slow);
    if (i < 25) continue;
    macd = fast - slow;
    signal = signal == null ? macd : signal + (2 / 10) * (macd - signal);
    count++;
  }
  const rsi =
    gain == null
      ? null
      : gain === 0 && loss === 0
        ? 50
        : loss === 0
          ? 100
          : 100 - 100 / (1 + gain / loss);
  return {
    ma5: average(5),
    ma20: average(20),
    ma60: average(60),
    rsi14: rsi,
    macd,
    signal: count >= 9 ? signal : null,
    histogram: count >= 9 ? macd - signal : null,
    count: close.length,
    label: samples.at(-1)?.label,
  };
}
