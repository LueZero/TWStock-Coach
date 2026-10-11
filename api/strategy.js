export const VERSION = "trend-breakout-v1";
export function technical(row) {
  const a = row.analysis ?? {},
    checks = [];
  const check = (label, keys, test, reason) => {
    const available = row.is_final && keys.every((k) => a[k] != null);
    checks.push({
      label,
      state: available ? (test() ? "pass" : "fail") : "unknown",
      reason,
    });
  };
  check(
    "趨勢",
    ["ma5", "ma20"],
    () => row.close > a.ma5 && a.ma5 > a.ma20,
    "收盤價 > MA5 > MA20",
  );
  check(
    "量價突破",
    ["prior_high20", "volume_ratio"],
    () => row.close > a.prior_high20 && a.volume_ratio >= 1.5,
    "突破前 20 根高點，量比 ≥ 1.5",
  );
  check(
    "MACD 動能",
    ["macd_histogram"],
    () => a.macd_histogram > 0,
    "MACD 高於訊號線",
  );
  check("KD 動能", ["k", "d"], () => a.k > a.d, "K > D；不以超賣直接認定反轉");
  check(
    "RSI 範圍",
    ["rsi14"],
    () => a.rsi14 >= 50 && a.rsi14 < 70,
    "50 ≤ RSI < 70；避免追逐過熱行情",
  );
  check(
    "風險距離",
    ["atr14"],
    () => a.atr14 > 0 && row.close > 2 * a.atr14,
    "ATR > 0，參考停損價須大於零",
  );
  return [
    checks.every((c) => c.state !== "unknown"),
    checks.every((c) => c.state === "pass"),
    checks,
  ];
}
export function evaluate(
  row,
  fundamentals = {},
  cost = null,
  shares = 0,
  initial_stop = null,
  peak = null,
  risk_budget = 1000,
) {
  const [ready, candidate, checks] = technical(row),
    gate = fundamentals.gate ?? "unknown",
    atr = row.analysis?.atr14;
  checks.push({
    label: "基本面確認",
    state: gate === "caution" ? "fail" : gate,
    reason: fundamentals.gate_note ?? "沒有當時可得的財報，不能視為通過",
  });
  let reference = null;
  if (ready && atr > 0 && row.close > 2 * atr)
    reference = {
      entry_reference: row.close,
      stop_reference: row.close - 2 * atr,
      target_reference: row.close + 4 * atr,
      risk_reward: 2,
      max_shares: Math.floor(risk_budget / (2 * atr)),
      note: "收盤後研究參考：停損距離 2×ATR、目標 2R；並非可成交報價，數量未計交易成本與資金上限。",
    };
  let status = !ready
    ? "warming_up"
    : candidate && gate === "pass"
      ? "candidate"
      : candidate && gate === "unknown"
        ? "await_fundamentals"
        : "wait";
  let holding = null;
  const labels = {
    warming_up: "資料不足，暫不判斷",
    candidate: "符合進場候選條件",
    await_fundamentals: "技術條件成立，待財報確認",
    wait: "等待條件成立",
    basis_mismatch: "持倉成本需搭配原始價格",
    pending: "K 線未完成，不產生正式持倉訊號",
    set_stop: "先設定固定停損價",
    invalid_stop: "原始停損價應低於成本；保本／移動停利請另評估",
    stop_loss: "已觸及固定停損條件",
    take_profit: "已達 2R 停利參考，評估減碼",
    trailing_review: "跌破移動停利參考，評估減碼",
    risk_review: "跌破 MA20，重新檢查續抱條件",
    over_budget: "停損風險超出預算，評估降低部位",
    hold: "未觸發停損／停利，持續觀察",
  };
  if (shares > 0 && cost != null) {
    holding = {
      cost,
      shares,
      stop: initial_stop,
      unrealized_pnl: null,
      risk_at_stop: null,
      trailing_reference: null,
      target: null,
    };
    if (row.price_basis !== "raw") status = "basis_mismatch";
    else if (!row.is_final) status = "pending";
    else {
      const price = row.close;
      holding.unrealized_pnl = (price - cost) * shares;
      if (initial_stop == null) status = "set_stop";
      else if (initial_stop >= cost) status = "invalid_stop";
      else {
        holding.risk_at_stop = (cost - initial_stop) * shares;
        holding.target = cost + 2 * (cost - initial_stop);
        if (peak != null && atr > 0 && peak >= Math.max(cost, price))
          holding.trailing_reference = Math.max(initial_stop, peak - 2 * atr);
        status =
          price <= initial_stop
            ? "stop_loss"
            : price >= holding.target
              ? "take_profit"
              : holding.trailing_reference != null &&
                  price <= holding.trailing_reference
                ? "trailing_review"
                : ready && price < row.analysis.ma20
                  ? "risk_review"
                  : holding.risk_at_stop > risk_budget
                    ? "over_budget"
                    : "hold";
      }
    }
  }
  return {
    version: VERSION,
    status,
    label: labels[status],
    checks,
    reference,
    holding,
    as_of: row.timestamp,
    price_basis: row.price_basis,
    technical_candidate: candidate,
    note: "固定研究規則，不是勝率或保證。持倉以所選完成 K 線收盤價判斷；盤中觸價不在此假定成交。移動停利僅為參考，不會自動修改固定停損。",
  };
}
export function backtest(
  input,
  fee_bps = 10,
  slippage_bps = 5,
  sell_tax_bps = 0,
) {
  const rows = input.filter((r) => r.is_final),
    fee = fee_bps / 10000,
    slip = slippage_bps / 10000,
    tax = sell_tax_bps / 10000;
  let cash = 1,
    equity = 1,
    peak_equity = 1,
    max_drawdown = 0,
    position = null,
    pending = null,
    previous = null;
  const trades = [],
    curve = [];
  for (const row of rows) {
    let exit_price = null,
      reason = null;
    if (
      position &&
      previous?.analysis?.ma20 != null &&
      previous.close < previous.analysis.ma20
    ) {
      exit_price = row.open;
      reason = "趨勢失效，次根開盤";
    } else if (position && row.open <= position.stop) {
      exit_price = row.open;
      reason = "跳空跌破停損";
    } else if (position && row.open >= position.target) {
      exit_price = row.open;
      reason = "跳空達停利";
    }
    if (!position && pending) {
      const entry = row.open * (1 + slip),
        distance = 2 * pending.atr;
      if (entry > distance) {
        position = {
          entry,
          quantity: cash / (entry * (1 + fee)),
          stop: entry - distance,
          target: entry + 2 * distance,
          date: row.trade_date,
          timestamp: row.timestamp,
          capital: cash,
          signal_at: pending.timestamp,
        };
        cash = 0;
      }
      pending = null;
    }
    if (position && exit_price == null) {
      if (row.low <= position.stop) {
        exit_price = position.stop;
        reason = "停損（同根雙觸價優先）";
      } else if (row.high >= position.target) {
        exit_price = position.target;
        reason = "2R 停利";
      }
    }
    let exited = false;
    if (position && exit_price != null) {
      const fill = exit_price * (1 - slip);
      cash = position.quantity * fill * (1 - fee - tax);
      trades.push({
        entry_date: position.date,
        entry_timestamp: position.timestamp,
        exit_date: row.trade_date,
        exit_timestamp: row.timestamp,
        signal_at: position.signal_at,
        entry: position.entry,
        exit: fill,
        return_percent: (cash / position.capital - 1) * 100,
        reason,
      });
      position = null;
      exited = true;
    }
    equity = position ? position.quantity * row.close : cash;
    peak_equity = Math.max(peak_equity, equity);
    max_drawdown = Math.max(max_drawdown, 1 - equity / peak_equity);
    curve.push({ timestamp: row.timestamp, equity });
    const [ready, candidate] = technical(row);
    if (!position && !exited && ready && candidate)
      pending = { atr: row.analysis.atr14, timestamp: row.timestamp };
    previous = row;
  }
  return {
    version: VERSION,
    bars: rows.length,
    trades,
    closed_trades: trades.length,
    win_rate_percent: trades.length
      ? (trades.filter((t) => t.return_percent > 0).length / trades.length) *
        100
      : null,
    return_percent: (equity - 1) * 100,
    max_drawdown_percent: max_drawdown * 100,
    buy_hold_price_return_percent: rows.length
      ? (rows.at(-1).close / rows[0].close - 1) * 100
      : null,
    open_position: position,
    pending_signal: pending,
    equity_curve: curve,
    cost_assumptions: {
      fee_bps_each_side: fee_bps,
      slippage_bps_each_side: slippage_bps,
      sell_tax_bps,
    },
    status:
      rows.length < 35
        ? "insufficient_data"
        : !trades.length
          ? "no_trades"
          : "research_only",
    limitations: [
      "僅技術規則回放，不包含財報篩選；不是樣本外驗證，也未最佳化參數。",
      "成本為使用者研究假設；賣出稅預設 0，須依商品與交易方式設定。",
      "未模擬漲跌停無法成交、委託排隊、流動性、最低手續費、整數股與資金規模。",
      "未完成 K 不交易；期末未平倉以收盤價評價，未扣未發生的賣出成本。",
      "原始價含除權息跳空且不計股利；還原價為合成價格，模擬結果均不是可成交保證。",
    ],
  };
}
