import { calculate, VERSION as indicatorVersion } from "./indicators.js";
import { scenarioPrice, tickCents, moveTicks } from "./calculator.js";
import { addDays, num } from "./lib.js";
import {
  technicalObservations,
  chartAnnotations,
} from "./report-observations.js";

export const RULE_VERSION = "report-swing-v3";
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
          "ma10",
          "ma20",
          "ma60",
          "ma120",
          "ma240",
          "rsi14",
          "macd",
          "macd_signal",
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
          ? "指標值"
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
      scenarios.push({
        id: "breakout",
        label: "突破確認觀察",
        trigger,
        stop,
        target,
        confirmed: breakout,
        enabled: true,
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
        note: "僅為技術候選價位，不是已成交買點；不預設本金、持倉、費用或部位，跳空與滑價可能擴大損失。",
      });
    }
  }
  const observations = technicalObservations(calculated);
  const short = observations.find((r) => r.id === "short_trend");
  const alignment = observations.find((r) => r.id === "alignment");
  const planChecks = [
    {
      id: "history",
      label: "至少60根完成日K",
      passed: bars.length >= 60,
      detail: `已取得 ${bars.length} 根完成觀測。`,
    },
    {
      id: "continuity",
      label: "最近60交易日資料齊備",
      passed: !!packet.continuity_verified,
      detail: packet.continuity_verified
        ? "符合平台交易日曆檢查。"
        : "可能缺漏或停牌；不補零。",
    },
    {
      id: "freshness",
      label: "行情符合預期日期",
      passed: reference?.trade_date === packet.expected_last_day,
      detail: `行情 ${reference?.trade_date || "未取得"}；預期 ${packet.expected_last_day}。`,
    },
    {
      id: "atr",
      label: "波動幅度可計算",
      passed: metrics.atr14 > 0,
      detail: `ATR14 ${metrics.atr14 == null ? "缺值" : metrics.atr14.toFixed(2)}。`,
    },
    {
      id: "price",
      label: "收盤突破前20日高點",
      passed: !!(
        last &&
        metrics.prior_high20 != null &&
        last.close > metrics.prior_high20
      ),
      detail:
        reference && metrics.prior_high20 != null
          ? `收盤 ${Number(reference.close).toFixed(2)} 元；前20日高點 ${metrics.prior_high20.toFixed(2)} 元。`
          : "價格資料不足。",
    },
    {
      id: "volume",
      label: "量比至少1.5倍",
      passed: metrics.volume_ratio != null && metrics.volume_ratio >= 1.5,
      detail: `目前量比 ${metrics.volume_ratio == null ? "缺值" : metrics.volume_ratio.toFixed(2)} 倍。`,
    },
    {
      id: "trend",
      label: "中期趨勢未轉空",
      passed: trend !== "oppose" && trend !== "missing",
      detail:
        trend === "oppose"
          ? "收盤 < MA20 < MA60。"
          : trend === "missing"
            ? "MA20／MA60缺值。"
            : "沒有符合收盤 < MA20 < MA60。",
    },
  ];
  const status = !required
    ? "insufficient"
    : breakout && trend === "support"
      ? "confirmed"
      : trend === "oppose"
        ? "wait"
        : "watch";
  const labels = {
    insufficient: "資料不足，先補齊",
    wait: "波段趨勢偏弱",
    watch: `${short?.label || "短線待判讀"} · ${alignment?.label || "中期待判讀"}`,
    confirmed: "技術突破已確認，仍需核對風險",
  };
  const holding = null;
  return {
    version: RULE_VERSION,
    meta: {
      market: packet.market,
      symbol: packet.symbol,
      name: packet.name,
      industry: packet.industry,
      asset: packet.asset,
      as_of: packet.as_of,
      mode: packet.mode,
      start: packet.start,
      range_mode: packet.range_mode || "manual",
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
      ...(short ? [short.note] : ["尚無完成日K可分析。"]),
      ...(alignment ? [alignment.note] : []),
      required
        ? breakout
          ? "前20日高點與1.5倍量能條件均達成；下方另核對趨勢與行情條件。"
          : `突破策略尚欠：${planChecks
              .filter((c) => ["price", "volume"].includes(c.id) && !c.passed)
              .map((c) => c.label)
              .join("、")}。這是此策略的檢核，不表示其他面向無法分析。`
        : `價位計畫暫停：${planChecks
            .filter(
              (c) =>
                ["history", "continuity", "freshness", "atr"].includes(c.id) &&
                !c.passed,
            )
            .map((c) => c.label)
            .join("、")}；仍可閱讀已取得指標。`,
    ],
    metrics,
    observations,
    plan_checks: planChecks,
    context: { ...packet.context },
    facets: [
      {
        id: "technical",
        label: "技術趨勢",
        state: trend,
        note: alignment?.note || "MA20／MA60資料不足。",
      },
      {
        id: "momentum",
        label: "技術動能",
        state: momentum,
        note:
          observations.find((r) => r.id === "macd")?.note || "MACD暖機不足。",
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
        ma5: b.ma5,
        ma20: b.ma20,
        ma60: b.ma60,
        technical_label: technicalObservations([b])
          .filter((r) => ["short_trend", "alignment"].includes(r.id))
          .map((r) => r.label)
          .join(" · "),
      })),
    chart_annotations: chartAnnotations(calculated, packet.start, packet.end),
    ai: null,
    limitations: [
      "沒有保證獲利或已校準勝率；資料覆蓋率不是獲利機率。",
      "正式條件只使用完成日K；最新盤中行情、五檔不作為收盤確認。",
      "原始價格研究；未驗證公司行動調整，除權息／減資後需重算計畫。",
      "第一版為波段條件報告；未模擬委託排隊、跳空與無法成交。",
    ],
  };
}
