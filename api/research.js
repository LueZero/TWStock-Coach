import { sum, fail } from "./lib.js";
const mean = (v) => sum(v) / v.length,
  std = (v) => {
    const m = mean(v);
    return Math.sqrt(mean(v.map((x) => (x - m) ** 2)));
  },
  dot = (a, b) => sum(a.map((v, i) => v * b[i]));
function solve(a, b) {
  const m = a.map((r, i) => [...r, b[i]]),
    n = b.length;
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs(m[r][c]) > Math.abs(m[pivot][c])) pivot = r;
    if (Math.abs(m[pivot][c]) < 1e-15) fail("Regression matrix is singular");
    [m[c], m[pivot]] = [m[pivot], m[c]];
    const factor = m[c][c];
    for (let j = c; j <= n; j++) m[c][j] /= factor;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const v = m[r][c];
      for (let j = c; j <= n; j++) m[r][j] -= v * m[c][j];
    }
  }
  return m.map((r) => r[n]);
}
const quantile = (values, p) => {
  const v = [...values].sort((a, b) => a - b),
    i = (v.length - 1) * p,
    lo = Math.floor(i),
    hi = Math.ceil(i);
  return v[lo] + (v[hi] - v[lo]) * (i - lo);
};
export function forecast(rows, horizon = 5, minTrain = 120) {
  if (rows.length < minTrain + horizon + 40)
    fail(`至少需要 ${minTrain + horizon + 40} 根完成且連續可用的還原日線`);
  const close = rows.map((r) => Number(r.close)),
    ret = close.map((v, i) => (i ? v / close[i - 1] - 1 : NaN)),
    x = close.map((v, i) =>
      i >= 20
        ? [
            ret[i],
            v / close[i - 5] - 1,
            v / close[i - 20] - 1,
            std(ret.slice(i - 19, i + 1)),
            v / mean(close.slice(i - 19, i + 1)) - 1,
          ]
        : Array(5).fill(NaN),
    ),
    y = close.map((v, i) =>
      i + horizon < close.length ? close[i + horizon] / v - 1 : NaN,
    ),
    evaluation = [];
  let latest = null;
  for (let i = 20 + minTrain + horizon; i < rows.length; i++) {
    const eligible = [];
    for (let j = 20; j <= i - horizon; j++)
      if (x[j].every(Number.isFinite) && Number.isFinite(y[j]))
        eligible.push(j);
    const train = eligible.slice(-500);
    if (train.length < minTrain || !x[i].every(Number.isFinite)) continue;
    const means = Array.from({ length: 5 }, (_, j) =>
        mean(train.map((k) => x[k][j])),
      ),
      scales = Array.from({ length: 5 }, (_, j) =>
        std(train.map((k) => x[k][j])),
      ).map((v) => (v < 1e-12 ? 1 : v)),
      design = train.map((k) => [
        1,
        ...x[k].map((v, j) => (v - means[j]) / scales[j]),
      ]),
      ty = train.map((k) => y[k]),
      a = Array.from({ length: 6 }, (_, j) =>
        Array.from(
          { length: 6 },
          (_, k) =>
            sum(design.map((r) => r[j] * r[k])) + (j === k && j > 0 ? 10 : 0),
        ),
      ),
      b = Array.from({ length: 6 }, (_, j) =>
        sum(design.map((r, k) => r[j] * ty[k])),
      ),
      coef = solve(a, b),
      estimate = dot(
        [1, ...x[i].map((v, j) => (v - means[j]) / scales[j])],
        coef,
      ),
      residual = design.map((r, j) => ty[j] - dot(r, coef));
    latest = {
      as_of: rows[i].trade_date,
      expected_return: estimate,
      residual_band_10_90: [
        estimate + quantile(residual, 0.1),
        estimate + quantile(residual, 0.9),
      ],
      training_rows: train.length,
      last_training_feature_index: train.at(-1),
      last_training_outcome_index: train.at(-1) + horizon,
      prediction_index: i,
    };
    if (Number.isFinite(y[i]))
      evaluation.push({
        as_of: rows[i].trade_date,
        prediction: estimate,
        actual: y[i],
        baseline: mean(ty),
      });
  }
  if (!latest) fail("insufficient valid observations");
  let metrics = null;
  if (evaluation.length) {
    const mae = mean(evaluation.map((e) => Math.abs(e.prediction - e.actual))),
      baseline = mean(evaluation.map((e) => Math.abs(e.baseline - e.actual)));
    metrics = {
      samples: evaluation.length,
      mae,
      baseline_mae: baseline,
      zero_return_mae: mean(evaluation.map((e) => Math.abs(e.actual))),
      direction_accuracy: mean(
        evaluation.map((e) => Number(e.prediction > 0 === e.actual > 0)),
      ),
      beats_historical_mean_baseline: mae < baseline,
    };
  }
  return {
    model_version: "ridge-5d-v1",
    horizon_trading_observations: horizon,
    price_basis: "adjusted",
    status: "research_only",
    latest,
    walk_forward_metrics: metrics,
    evaluation,
    limitations: [
      "尚未完成交易成本與可成交性回測，不提供交易建議",
      "區間為訓練殘差分位數，並非經校準的信賴區間",
      "五日標籤互相重疊，誤差樣本並非獨立",
      "供應商當前還原歷史不是 point-in-time 快照；不能宣稱歷史實盤績效",
      "期間以有效價格觀測計數；停牌或資料缺漏可能延長實際交易日期間",
    ],
  };
}
