export const EVENT_VERSION = "technical-events-v1";
const valid = (...values) =>
  values.every((v) => typeof v === "number" && Number.isFinite(v));
const f = (v) => Number(v).toFixed(2);

export function trendState(row) {
  if (row.is_final !== true) return { code: "forming", label: "K線未完成" };
  if (!valid(row.ma5, row.ma20, row.ma60))
    return { code: "warming_up", label: "均線暖機不足" };
  return row.ma5 > row.ma20 && row.ma20 > row.ma60
    ? { code: "bullish", label: "均線多頭排列" }
    : row.ma5 < row.ma20 && row.ma20 < row.ma60
      ? { code: "bearish", label: "均線空頭排列" }
      : { code: "mixed", label: "均線交錯" };
}

// Compare only completed candles, with the same period and price basis. No future
// candles, centred windows or retrospective buy/sell labels enter these rules.
export function annotateTechnicalRows(rows) {
  let previous = null;
  return rows.map((row) => {
    const r = {
      ...row,
      technical_state: trendState(row),
      technical_events: [],
      signals: [],
    };
    if (row.is_final !== true) return r;
    const p = previous;
    const mark = (code, kind, category, label, short_label, note, values) => {
      r.technical_events.push({
        event_id: `${r.timestamp}:${code}`,
        timestamp: r.timestamp,
        date: r.trade_date,
        code,
        kind,
        category,
        label,
        short_label,
        note,
        values,
        rule_version: EVENT_VERSION,
      });
    };
    const cross = (code, a, b, category, name, short) => {
      if (!p || !valid(p[a], p[b], r[a], r[b])) return;
      const note = `前期 ${name} ${f(p[a])}／${f(p[b])}，本期 ${f(r[a])}／${f(r[b])}；只比較完成K線。`;
      if (p[a] <= p[b] && r[a] > r[b])
        mark(
          `${code}_up`,
          "support",
          category,
          `${name}黃金交叉`,
          `${short}金叉`,
          note,
          { previous_fast: p[a], previous_slow: p[b], fast: r[a], slow: r[b] },
        );
      if (p[a] >= p[b] && r[a] < r[b])
        mark(
          `${code}_down`,
          "oppose",
          category,
          `${name}死亡交叉`,
          `${short}死叉`,
          note,
          { previous_fast: p[a], previous_slow: p[b], fast: r[a], slow: r[b] },
        );
    };
    cross("ma5_ma20", "ma5", "ma20", "ma", "MA5／MA20", "均線");
    cross("macd", "macd", "macd_signal", "momentum", "MACD", "MACD");
    cross("kd", "k", "d", "momentum", "KD", "KD");
    if (
      p &&
      ["bullish", "bearish"].includes(r.technical_state.code) &&
      p.technical_state.code !== "warming_up" &&
      p.technical_state.code !== r.technical_state.code
    )
      mark(
        `alignment_${r.technical_state.code}`,
        r.technical_state.code === "bullish" ? "support" : "oppose",
        "ma",
        `轉為${r.technical_state.label}`,
        r.technical_state.code === "bullish" ? "轉多排列" : "轉空排列",
        `MA5 ${f(r.ma5)}、MA20 ${f(r.ma20)}、MA60 ${f(r.ma60)}；排列改變不代表三條均線斜率皆同向。`,
        { ma5: r.ma5, ma20: r.ma20, ma60: r.ma60 },
      );
    if (p && valid(p.close, p.ma20, r.close, r.ma20)) {
      if (p.close <= p.ma20 && r.close > r.ma20)
        mark(
          "close_above_ma20",
          "support",
          "levels",
          "收盤站回MA20",
          "站回MA20",
          `前期收盤 ${f(p.close)}／MA20 ${f(p.ma20)}，本期收盤 ${f(r.close)}／MA20 ${f(r.ma20)}。`,
          { close: r.close, ma20: r.ma20 },
        );
      if (p.close >= p.ma20 && r.close < r.ma20)
        mark(
          "close_below_ma20",
          "oppose",
          "levels",
          "收盤跌破MA20",
          "跌破MA20",
          `前期收盤 ${f(p.close)}／MA20 ${f(p.ma20)}，本期收盤 ${f(r.close)}／MA20 ${f(r.ma20)}。`,
          { close: r.close, ma20: r.ma20 },
        );
    }
    for (const [field, code, kind, label, compare] of [
      [
        "prior_high20",
        "break_high20",
        "support",
        "突破前20期高點",
        (a, b) => a > b,
      ],
      [
        "prior_low20",
        "break_low20",
        "oppose",
        "跌破前20期低點",
        (a, b) => a < b,
      ],
    ]) {
      if (
        p &&
        valid(p.close, p[field], r.close, r[field]) &&
        compare(r.close, r[field]) &&
        !compare(p.close, p[field])
      )
        mark(
          code,
          kind,
          "levels",
          label,
          kind === "support" ? "突破20高" : "跌破20低",
          `收盤 ${f(r.close)}，前20期${kind === "support" ? "最高" : "最低"}價 ${f(r[field])}（不含本期）；${valid(r.volume_ratio) ? `量比 ${f(r.volume_ratio)}${r.volume_ratio >= 1.5 ? "，達1.5倍" : "，未達1.5倍"}` : "量比不足"}。`,
          {
            close: r.close,
            reference: r[field],
            volume_ratio: r.volume_ratio ?? null,
          },
        );
    }
    r.signals = r.technical_events.map((e) => e.label);
    previous = r;
    return r;
  });
}
