import { calculate, VERSION as indicatorVersion } from "./indicators.js";
import {
  scenarioPrice,
  tickCents,
  moveTicks,
  calculate as tradeCost,
} from "./calculator.js";
import { addDays, taipeiDay, num } from "./lib.js";

export const RULE_VERSION = "report-swing-v1";
export function legalPrice(value, asset = "stock", direction = "nearest") {
  if (!(value > 0) || value > 1000000) return null;
  let cents = Math.round(value * 100);
  for (let i = 0; i < 4; i++) {
    const tick = tickCents(cents, asset);
    const round =
      direction === "up"
        ? Math.ceil
        : direction === "down"
          ? Math.floor
          : Math.round;
    cents = round((value * 100) / tick) * tick;
    if (cents % tickCents(cents, asset) === 0) return cents / 100;
  }
  return Number(scenarioPrice(value, 0, asset));
}

export function buildRuleReport(packet) {
  const bars = packet.bars
    .filter((b) => b.is_final)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const calculated = calculate(bars),
    last = calculated.at(-1),
    evidence = [...packet.evidence];
  const quality = [...packet.quality];
  const metrics = last
    ? Object.fromEntries(
        [
          "ma5",
          "ma20",
          "ma60",
          "ma240",
          "rsi14",
          "macd_histogram",
          "volume_ratio",
          "atr14",
          "k",
          "d",
          "bb_upper",
          "bb_lower",
          "prior_high20",
        ].map((k) => [k, num(last[k])]),
      )
    : {};
  const reference = bars.at(-1);
  if (reference)
    evidence.unshift({
      id: "price:last",
      category: "technical",
      label: "最後完成日K收盤",
      value: reference.close,
      unit: "元",
      date: reference.trade_date,
      source_time: reference.source_time,
      received_at: reference.received_at,
      source: reference.source,
      revisions: [{ id: reference.id, revision: reference.revision }],
    });
  for (const [key, value] of Object.entries(metrics))
    if (value != null)
      evidence.push({
        id: `technical:${key}`,
        category: "technical",
        label: key,
        value,
        unit: ["rsi14", "k", "d"].includes(key)
          ? "%"
          : key === "volume_ratio"
            ? "倍"
            : "元",
        date: reference.trade_date,
        source: "平台完成日K計算",
        version: indicatorVersion,
        revisions: bars
          .slice(-Math.max(240, 60))
          .map((b) => ({ id: b.id, revision: b.revision })),
      });
  if (bars.length < 60)
    quality.push({
      severity: "warning",
      label: `只有 ${bars.length} 根完成日K；至少60根才啟用波段計畫，長均線需240根。`,
    });
  if (!packet.continuity_verified)
    quality.push({
      severity: "warning",
      label: "區間交易日完整性未確認，暫不啟用正式進場計畫。",
    });
  if (reference && reference.trade_date < packet.expected_last_day)
    quality.push({
      severity: "warning",
      label: `行情只到 ${reference.trade_date}，落後預期交易日 ${packet.expected_last_day}。`,
    });
  const required =
    bars.length >= 60 &&
    packet.continuity_verified &&
    reference?.trade_date === packet.expected_last_day &&
    metrics.atr14 > 0;
  const trend =
    last && metrics.ma20 != null && metrics.ma60 != null
      ? last.close > metrics.ma20 && metrics.ma20 > metrics.ma60
        ? "support"
        : last.close < metrics.ma20 && metrics.ma20 < metrics.ma60
          ? "oppose"
          : "neutral"
      : "missing";
  const momentum =
    metrics.macd_histogram == null
      ? "missing"
      : metrics.macd_histogram > 0
        ? "support"
        : "oppose";
  const breakout = !!(
    last &&
    metrics.prior_high20 != null &&
    last.close > metrics.prior_high20 &&
    metrics.volume_ratio >= 1.5
  );
  const scenarios = [];
  if (required) {
    const asset = packet.asset;
    const pressure = legalPrice(metrics.prior_high20, asset, "up");
    const trigger = pressure ? Number(moveTicks(pressure, 1, asset)) : null;
    const stop = trigger
      ? legalPrice(trigger - 2 * metrics.atr14, asset, "down")
      : null;
    const target =
      stop > 0 ? legalPrice(trigger + 2 * (trigger - stop), asset, "up") : null;
    if (trigger && stop > 0 && target > trigger && trend !== "oppose") {
      let maxShares = 0;
      const holding = packet.context;
      const costFor = (qty, sell) =>
        tradeCost(
          {
            trade_date: packet.end,
            asset,
            mode: "roundtrip",
            quantity: qty,
            unit: "shares",
            buy_price: trigger,
            sell_price: sell,
            discount: holding.discount,
            minimum_fee: holding.minimum_fee,
          },
          false,
        );
      let lo = 0,
        hi = Math.min(10000000, Math.floor(holding.capital / trigger));
      while (lo < hi) {
        const mid = Math.floor((lo + hi + 1) / 2),
          cost = costFor(mid, stop);
        if (
          -Number(cost.net_profit) <= holding.risk_budget &&
          -Number(cost.legs[0].cash_flow) <= holding.capital
        )
          lo = mid;
        else hi = mid - 1;
      }
      maxShares = lo;
      const loss = maxShares ? costFor(maxShares, stop) : null,
        gain = maxShares ? costFor(maxShares, target) : null;
      const ratio =
        loss && Number(loss.net_profit) < 0
          ? Number(gain.net_profit) / -Number(loss.net_profit)
          : null;
      scenarios.push({
        id: "breakout",
        label: "突破確認觀察",
        trigger,
        stop,
        target,
        confirmed: breakout,
        enabled: maxShares > 0 && ratio >= 1.5,
        max_shares: maxShares,
        risk_at_stop: loss ? -Number(loss.net_profit) : null,
        net_reward_risk: ratio,
        valid_until: addDays(packet.end, 7),
        evidence_ids: [
          "price:last",
          "technical:prior_high20",
          "technical:volume_ratio",
          "technical:atr14",
        ],
        conditions: [
          "完成日K收盤高於壓力價，量比至少1.5。",
          "進場仍需核對當日大盤、成交價格與最新資料。",
        ],
        invalidation:
          "完成日K收盤跌破失效價即取消趨勢計畫；若採盤中硬停損需另設委託，不能混用。",
        note:
          ratio >= 1.5
            ? "僅為候選條件，不是已成交買點；費稅已納入，跳空與滑價可能擴大損失。"
            : "成本後報酬風險不足或資金額度不足，此情境停用。",
      });
    }
  }
  let status = !required
    ? "insufficient"
    : breakout && trend === "support"
      ? "confirmed"
      : trend === "oppose"
        ? "wait"
        : "watch";
  const labels = {
    insufficient: "資料不足，先補齊",
    wait: "先等待",
    watch: "觀察條件，尚未確認",
    confirmed: "技術突破已確認，仍需核對風險",
  };
  const holding =
    packet.context.shares > 0 && packet.context.cost > 0 && reference
      ? {
          cost: packet.context.cost,
          shares: packet.context.shares,
          unrealized_gross:
            (reference.close - packet.context.cost) * packet.context.shares,
          exit_condition: metrics.ma20
            ? `完成日K收盤跌破MA20（${metrics.ma20.toFixed(2)}）需檢查續抱假設；不等於固定停損委託。`
            : "技術資料不足，不能判斷續抱；請先設定可承受損失。",
          note: "未實現損益未扣費稅；未輸入初始停損，不推定你的停損價。",
        }
      : null;
  return {
    version: RULE_VERSION,
    meta: {
      market: packet.market,
      symbol: packet.symbol,
      name: packet.name,
      as_of: packet.as_of,
      mode: packet.mode,
      start: packet.start,
      end: packet.end,
      price_basis: "raw",
      resolution: "1d",
      horizon: "swing",
      data_date: reference?.trade_date ?? null,
      created_at: new Date().toISOString(),
    },
    status,
    status_label: labels[status],
    summary: [
      labels[status],
      trend === "support"
        ? "收盤站在MA20之上，MA20高於MA60；波段趨勢偏強。"
        : trend === "oppose"
          ? "收盤低於MA20，MA20低於MA60；波段趨勢偏弱。"
          : "均線方向尚未一致，或資料不足。",
      "技術狀態不代表整體買入建議；財務、籌碼、大盤與缺資料需一起核對。",
    ],
    metrics,
    context: { ...packet.context },
    facets: [
      {
        id: "technical",
        label: "技術趨勢",
        state: trend,
        note: "日線MA20與MA60的相對位置。",
      },
      {
        id: "momentum",
        label: "技術動能",
        state: momentum,
        note: "MACD柱狀值；與均線相關，不重複當成獨立支持票。",
      },
      ...packet.facets,
    ],
    scenarios,
    holding,
    evidence,
    quality,
    chart_bars: calculated
      .filter((b) => b.trade_date >= packet.start && b.trade_date <= packet.end)
      .slice(-120)
      .map((b) => ({
        timestamp: b.timestamp,
        id: b.id,
        revision: b.revision,
        trade_date: b.trade_date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
        ma20: b.ma20,
        ma60: b.ma60,
      })),
    ai: null,
    limitations: [
      "沒有保證獲利或已校準勝率；資料覆蓋率不是獲利機率。",
      "正式條件只使用完成日K；最新盤中行情、五檔不作為收盤確認。",
      "原始價格研究；未驗證公司行動調整，除權息／減資後需重算計畫。",
      "第一版為波段條件報告；未模擬委託排隊、跳空與無法成交。",
    ],
  };
}
