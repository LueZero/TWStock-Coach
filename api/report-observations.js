import { num, sum } from "./lib.js";
import { annotateTechnicalRows } from "./technical-events.js";

export const assetType = (symbol, industry = "") =>
  /ETF|指數股票型基金/i.test(industry) || /^00\d{2,}[A-Z]?$/i.test(symbol)
    ? "etf"
    : "stock";

export function chronological(items = []) {
  return [...items].sort((a, b) =>
    String(a.date || a.trade_date || "").localeCompare(
      String(b.date || b.trade_date || ""),
    ),
  );
}

export function institutionObservation(items, expectedDay) {
  const rows = chronological(items),
    last = rows.at(-1),
    date = last?.date || last?.trade_date,
    recent = rows.slice(-5),
    total =
      recent.length && recent.every((r) => num(r.total) != null)
        ? sum(recent.map((r) => num(r.total)))
        : null,
    fresh = date === expectedDay;
  return {
    rows,
    last,
    date,
    fresh,
    state:
      !fresh || num(last?.total) == null
        ? "missing"
        : last.total > 0
          ? "support"
          : last.total < 0
            ? "oppose"
            : "neutral",
    note: last
      ? `最後法人資料 ${date}，當日合計 ${num(last.total) == null ? "缺漏" : last.total.toLocaleString("zh-TW") + "股"}；最近已取得 ${recent.length} 筆合計 ${total == null ? "缺漏" : total.toLocaleString("zh-TW") + "股"}。${fresh ? "日期符合預期；觀測筆數不保證連續交易日。" : "非最新預期交易日，不當成當日方向。"}`
      : "未取得法人交易資料。",
  };
}

const price = (value) => (num(value) == null ? "缺值" : num(value).toFixed(2));
export function technicalObservations(rows) {
  const last = rows.at(-1),
    previous = rows.at(-2),
    readings = [];
  if (!last) return readings;
  const add = (id, label, state, note, keys) =>
    readings.push({
      id,
      label,
      state,
      note,
      date: last.trade_date,
      evidence_ids: keys.map((key) =>
        key === "close" ? "price:last" : `technical:${key}`,
      ),
    });
  const short = [last.close, last.ma5, last.ma20].every((v) => num(v) != null);
  const wave = [last.ma5, last.ma20, last.ma60].every((v) => num(v) != null);
  if (short) {
    const strong = last.close > last.ma5 && last.ma5 > last.ma20,
      weak = last.close < last.ma5 && last.ma5 < last.ma20;
    add(
      "short_trend",
      strong ? "短線偏強" : weak ? "短線偏弱" : "短線整理",
      strong ? "support" : weak ? "oppose" : "neutral",
      `收盤 ${price(last.close)} 元、MA5 ${price(last.ma5)} 元、MA20 ${price(last.ma20)} 元；${strong ? "價格位於兩條短均線之上。" : weak ? "價格位於兩條短均線之下。" : "價格與短均線方向分歧，屬整理，並非資料不足。"}`,
      ["close", "ma5", "ma20"],
    );
  } else
    add(
      "short_trend",
      "短線資料不足",
      "missing",
      "MA5／MA20尚未有足夠完成觀測，不能判斷排列。",
      [],
    );
  if (wave) {
    const bull = last.ma5 > last.ma20 && last.ma20 > last.ma60,
      bear = last.ma5 < last.ma20 && last.ma20 < last.ma60;
    add(
      "alignment",
      bull ? "均線多頭排列" : bear ? "均線空頭排列" : "均線交錯",
      bull ? "support" : bear ? "oppose" : "neutral",
      `MA5 ${price(last.ma5)} 元、MA20 ${price(last.ma20)} 元、MA60 ${price(last.ma60)} 元；${bull ? "MA5 > MA20 > MA60。" : bear ? "MA5 < MA20 < MA60。" : last.ma20 > last.ma60 ? "MA20仍高於MA60，但短均線未保持多頭順序。" : "短中長均線尚未同向排列。"}排列描述結構，不等於三條均線斜率都向上或買點成立。`,
      ["ma5", "ma20", "ma60"],
    );
  } else
    add(
      "alignment",
      "中期均線資料不足",
      "missing",
      "MA60暖機不足；仍可閱讀已取得的短線指標。",
      [],
    );
  const back = rows.at(-6);
  if (num(last.ma20) != null && num(back?.ma20) != null)
    add(
      "slope",
      last.ma20 > back.ma20
        ? "MA20向上"
        : last.ma20 < back.ma20
          ? "MA20向下"
          : "MA20走平",
      last.ma20 > back.ma20
        ? "support"
        : last.ma20 < back.ma20
          ? "oppose"
          : "neutral",
      `MA20與前5筆完成觀測比較為${last.ma20 > back.ma20 ? "上升" : last.ma20 < back.ma20 ? "下降" : "持平"}；與均線相對排列分開判斷。`,
      ["ma20"],
    );
  if (num(last.macd_histogram) != null) {
    const crossUp =
        num(previous?.macd_histogram) != null &&
        previous.macd_histogram <= 0 &&
        last.macd_histogram > 0,
      crossDown =
        num(previous?.macd_histogram) != null &&
        previous.macd_histogram >= 0 &&
        last.macd_histogram < 0,
      change =
        num(previous?.macd_histogram) == null
          ? "沒有前筆可比較"
          : last.macd_histogram > previous.macd_histogram
            ? "柱狀值較前筆增加"
            : last.macd_histogram < previous.macd_histogram
              ? "柱狀值較前筆減少"
              : "柱狀值與前筆相同";
    add(
      "macd",
      crossUp
        ? "MACD黃金交叉"
        : crossDown
          ? "MACD死亡交叉"
          : last.macd_histogram > 0
            ? "MACD正動能"
            : last.macd_histogram < 0
              ? "MACD負動能"
              : "MACD動能平衡",
      last.macd_histogram > 0
        ? "support"
        : last.macd_histogram < 0
          ? "oppose"
          : "neutral",
      `MACD柱狀值 ${price(last.macd_histogram)} 元，${change}；正負表示MACD與訊號線的相對位置，不能單獨判定買賣。`,
      ["macd_histogram"],
    );
  }
  if (num(last.rsi14) != null)
    add(
      "rsi",
      last.rsi14 >= 70
        ? "RSI偏熱"
        : last.rsi14 <= 30
          ? "RSI偏弱"
          : last.rsi14 > 50
            ? "RSI中性偏強"
            : "RSI中性偏弱",
      last.rsi14 >= 70
        ? "neutral"
        : last.rsi14 <= 30
          ? "oppose"
          : last.rsi14 > 50
            ? "support"
            : "neutral",
      `RSI14 ${price(last.rsi14)}；70／30為觀察區，偏熱不直接代表賣出，偏弱不直接代表抄底。`,
      ["rsi14"],
    );
  if ([last.k, last.d].every((v) => num(v) != null)) {
    const before = [previous?.k, previous?.d].every((v) => num(v) != null),
      up = before && previous.k <= previous.d && last.k > last.d,
      down = before && previous.k >= previous.d && last.k < last.d;
    add(
      "kd",
      up
        ? "KD黃金交叉"
        : down
          ? "KD死亡交叉"
          : last.k > last.d
            ? "KD維持K高於D"
            : last.k < last.d
              ? "KD維持K低於D"
              : "KD兩線重合",
      last.k > last.d ? "support" : last.k < last.d ? "oppose" : "neutral",
      `K ${price(last.k)}、D ${price(last.d)}；只有與前筆完成觀測跨越才稱交叉，已在上方不重複稱新訊號。`,
      ["k", "d"],
    );
  }
  if (num(last.volume_ratio) != null)
    add(
      "volume",
      last.volume_ratio >= 1.5
        ? "量能放大"
        : last.volume_ratio < 0.8
          ? "量能縮小"
          : "量能接近常態",
      "neutral",
      `量比 ${price(last.volume_ratio)} 倍，以前20筆平均量為基準；${last.volume_ratio >= 1.5 ? "已達突破規則的量能門檻，仍要核對價格。" : "未達1.5倍放量突破門檻，但不代表所有策略都不能觀察。"}`,
      ["volume_ratio"],
    );
  if ([last.bb_upper, last.bb_lower].every((v) => num(v) != null))
    add(
      "bollinger",
      last.close > last.bb_upper
        ? "收盤高於布林上緣"
        : last.close < last.bb_lower
          ? "收盤低於布林下緣"
          : "收盤位於布林通道內",
      "neutral",
      `布林下緣 ${price(last.bb_lower)} 元、上緣 ${price(last.bb_upper)} 元；越界可能是延伸或反轉，需量價確認。`,
      ["close", "bb_upper", "bb_lower"],
    );
  return readings;
}

export function chartAnnotations(rows, start, end) {
  return annotateTechnicalRows(rows)
    .filter((r) => r.trade_date >= start && r.trade_date <= end)
    .flatMap((r) => r.technical_events);
}
