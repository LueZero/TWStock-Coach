import { renderOrderbook } from "./orderbook-view.js";
import {
  state,
  completed,
  isMinute,
  maPeriods,
  taipeiDay,
} from "./../models/stock-model.js";
import {
  selectStock,
  selectBar,
} from "./../controllers/dashboard-controller.js";
import { analysisChanged } from "./../controllers/analysis-controller.js";
import { renderFinancialResearch } from "./financial-view.js";

const $ = (id) => document.getElementById(id);

const fmt = (value) =>
  value == null || !Number.isFinite(Number(value))
    ? "—"
    : Number(value).toLocaleString("zh-TW", { maximumFractionDigits: 2 });

const localTime = (value) =>
  value
    ? new Date(value).toLocaleString("zh-TW", {
        timeZone: "Asia/Taipei",
        hour12: false,
      })
    : "來源未提供";

const colors = [
  "#78b8ff",
  "#f0c26c",
  "#bf9cfc",
  "#5fd0bb",
  "#f18fb1",
  "#c8d4e5",
];

let chartState = null;

const indicatorDefinitions = [
  ["ma5", "五日均線", "最近 5 根完成日 K 的平均收盤價"],
  ["ma10", "十日均線", "最近 10 根完成日 K 的平均收盤價"],
  ["ma20", "月線（二十日）", "最近 20 根完成日 K 的平均收盤價"],
  ["ma60", "季線（六十日）", "最近 60 根完成日 K 的平均收盤價"],
  ["ma120", "半年線（一百二十日）", "最近 120 根完成日 K 的平均收盤價"],
  ["ma240", "年線（二百四十日）", "最近 240 根完成日 K 的平均收盤價"],
  ["rsi14", "相對強弱（RSI 14）", "0～100 的動能指標；70 偏熱、30 偏弱"],
  ["macd", "趨勢動能（MACD）", "十二期快線減二十六期慢線"],
  ["macd_signal", "動能訊號線（MACD）", "MACD 的九期指數平滑線"],
  ["atr14", "平均真實波幅（ATR）", "近期每日波動幅度，單位為價格"],
  ["k", "隨機指標 K 值", "收盤價在九期高低區間的平滑位置"],
  ["d", "隨機指標 D 值", "K 值再平滑，觀察短期動能變化"],
  ["macd_histogram", "MACD 動能柱", "MACD 減訊號線，觀察快慢動能差距"],
  ["volume_ratio", "成交量比", "本期量除以前 20 根完成 K 線平均量，不含本期"],
  [
    "bb_upper",
    "布林通道上緣",
    "二十期均線加兩倍收盤價標準差；觸及不代表立即反轉",
  ],
  ["bb_lower", "布林通道下緣", "二十期均線減兩倍收盤價標準差；跌破不代表便宜"],
];

function message(text) {
  $("searchStatus").textContent = text;
  $("searchStatus").hidden = !text;
}

function amount(shares) {
  return fmt(
    shares == null
      ? null
      : $("volumeUnit").value === "lots"
        ? shares / 1000
        : shares,
  );
}

function signed(value, suffix = "") {
  return value == null ? "—" : `${value > 0 ? "+" : ""}${fmt(value)}${suffix}`;
}

function paintPrice(element, value, previous) {
  element.textContent = fmt(value);
  element.classList.remove("up", "down");
  if (value != null && previous != null && value !== previous)
    element.classList.add(value > previous ? "up" : "down");
}

function textCell(row, value, className = "") {
  const td = document.createElement("td");
  td.textContent = value;
  td.className = className;
  row.append(td);
  return td;
}

function emptyQuote() {
  [
    "lastPrice",
    "openPrice",
    "highPrice",
    "lowPrice",
    "previousClose",
    "totalVolume",
    "tradeDate",
  ].forEach((id) => {
    $(id).textContent = "—";
    $(id).classList.remove("up", "down");
  });
  $("priceChange").textContent = "等待行情";
  $("priceTime").textContent = "";
}

function renderFavorites() {
  const current = state.stock;
  $("favorites").replaceChildren();
  $("favoriteCount").textContent = state.favorites.length;
  state.favorites.forEach((stock) => {
    const button = document.createElement("button");
    button.className =
      "favorite" +
      (stock.market === current.market && stock.symbol === current.symbol
        ? " active"
        : "");
    const block = document.createElement("span");
    const code = document.createElement("span");
    code.className = "favorite-code";
    code.textContent = stock.symbol;
    const name = document.createElement("span");
    name.className = "favorite-name";
    name.textContent = stock.name || stock.symbol;
    block.append(code, name);
    const market = document.createElement("span");
    market.className = "favorite-market";
    market.textContent = stock.market === "TWSE" ? "上市" : "上櫃";
    button.append(block, market);
    button.onclick = () => selectStock(stock);
    $("favorites").append(button);
  });
  const added = state.favorites.some(
    (s) => s.market === current.market && s.symbol === current.symbol,
  );
  $("favoriteToggle").textContent = added ? "★" : "☆";
  $("favoriteToggle").setAttribute(
    "aria-label",
    added ? "移除自選股" : "加入自選股",
  );
}

function closeSuggestions() {
  $("suggestions").hidden = true;
  $("stockInput").setAttribute("aria-expanded", "false");
}

function renderQuote() {
  if (state.mode === "history") {
    renderHistoricalSummary();
    return;
  }
  const q = state.quote;
  if (!q) {
    emptyQuote();
    renderBook();
    return;
  }
  paintPrice($("lastPrice"), q.last_price, q.previous_close);
  $("priceChange").textContent =
    `${signed(q.change)}  (${signed(q.change_percent, "%")})`;
  $("priceChange").className = q.change > 0 ? "up" : q.change < 0 ? "down" : "";
  $("priceTime").textContent = "最新成交時間 " + localTime(q.trade_time);
  ["open", "high", "low"].forEach((key) =>
    paintPrice($(key + "Price"), q[key], q.previous_close),
  );
  $("previousClose").textContent = fmt(q.previous_close);
  $("totalVolume").textContent = amount(q.volume_shares);
  $("tradeDate").textContent = q.trade_date;
  $("volumeTitle").textContent =
    `累計成交量（${$("volumeUnit").value === "lots" ? "張" : "股"}）`;
  $("quoteStatus").textContent =
    `${q.state_label} · ${q.source_label} · 五檔來源時間 ${localTime(q.source_time)} · ${q.state === "unavailable" ? "更新失敗，保留上次資料" : `距來源時間 ${fmt(q.age_seconds / 60)} 分鐘`}。`;
  $("quoteStatus").className =
    "source-status" +
    (["previous_session", "delayed", "unavailable"].includes(q.state)
      ? " warning"
      : "");
  if (q.name) {
    $("stockName").textContent = q.name;
    state.stock.name = q.name;
  }
  renderBook();
  renderAnalysis();
}

function renderBook() {
  const q = state.mode === "live" ? state.quote : null;
  $("bookRows").replaceChildren();
  $("bookBadge").textContent =
    state.mode === "history"
      ? "歷史五檔未提供"
      : q
        ? q.state_label
        : "等待行情";
  $("bookTime").textContent = q
    ? `一般整股 · 數量單位：${$("volumeUnit").value === "lots" ? "張" : "股"} · ${localTime(q.source_time)}`
    : state.mode === "history"
      ? "歷史 K 線不包含當時委買委賣；勾選即時監控可查看最近五檔快照。"
      : "一般整股 · 最新公開快照";
  renderOrderbook({
    rows: $("bookRows"),
    balance: $("bookBalance"),
    quote: q,
    volumeKey: "volume_shares",
    quantity: amount,
    price: fmt,
  });
}

function periodLabel() {
  return (
    {
      "1d": "日",
      "1w": "週",
      "1mo": "月",
      "1m": "1 分",
      "5m": "5 分",
      "15m": "15 分",
      "30m": "30 分",
      "60m": "1 小時",
      "120m": "2 小時",
    }[state.resolution] || "快照"
  );
}

function historyResult(job) {
  const range = `${state.range.start} 至 ${state.range.end} · ${state.rows.length} 根 ${periodLabel()} K`;
  updateRangeStatus();
  if (job.status === "failed" || job.status === "no_data")
    $("rangeStatus").textContent +=
      ` · ${job.details?.message || "來源未提供資料"}`;
  return job.status === "failed"
    ? `${range} · ${job.details?.message || "來源載入失敗，請查看工作紀錄或權限"}`
    : job.status === "no_data"
      ? `${range} · 來源無資料，未補造價格`
      : `${range} · 已載入${job.status === "quality_warning" ? "，部分異常價格未匯入" : ""}`;
}

function renderHistoricalSummary() {
  const all = completed(),
    last = all.at(-1),
    prev = all.at(-2);
  if (!last) {
    emptyQuote();
    $("quoteStatus").textContent =
      `所選歷史區間尚無有效 ${periodLabel()} K，正在自動載入或來源未提供。`;
    return;
  }
  paintPrice($("lastPrice"), last.close, prev?.close);
  $("priceChange").textContent = prev
    ? `${signed(last.close - prev.close)} (${signed((last.close / prev.close - 1) * 100, "%")})`
    : "—";
  $("priceChange").className = prev
    ? last.close >= prev.close
      ? "up"
      : "down"
    : "";
  $("priceTime").textContent = "歷史收盤日期 " + last.trade_date;
  ["open", "high", "low"].forEach((key) =>
    paintPrice($(key + "Price"), last[key], prev?.close),
  );
  $("previousClose").textContent = fmt(prev?.close);
  $("totalVolume").textContent = amount(last.volume);
  $("volumeTitle").textContent =
    `該期成交量（${$("volumeUnit").value === "lots" ? "張" : "股"}）`;
  $("tradeDate").textContent = last.trade_date;
  $("quoteStatus").textContent =
    `歷史區間 · ${state.range.start} 至 ${state.range.end} · 價格依最後一根完成 ${periodLabel()} K 顯示，不是目前報價。`;
  $("quoteStatus").className = "source-status";
}

function interpretIndicator(key, row) {
  const a = row?.analysis,
    value = a?.[key];
  if (value == null)
    return {
      tone: "neutral",
      label: row && !row.is_final ? "K 線未完成" : "資料不足／指標暖機中",
      attention:
        "不把空值當零。均線要有足夠期數，RSI／MACD 等也需暖機；未完成 K 線不產生正式判讀。",
    };
  if (/^ma\d+$/.test(key)) {
    const delta = row.close - value;
    return {
      tone: delta > 0 ? "bull" : delta < 0 ? "bear" : "neutral",
      label: `所選 K 收盤${delta > 0 ? "高於" : delta < 0 ? "低於" : "等於"}均線 ${fmt(Math.abs(delta))}`,
      attention:
        "觀察價格位置與均線排列。均線會落後價格；盤整容易反覆穿越，原始價除權息也可能改變排列。這裡比較同價格基準的完成 K 收盤價，不使用即時報價混比。",
    };
  }
  if (key === "rsi14")
    return {
      tone:
        value >= 70 || value <= 30
          ? "watch"
          : value > 50
            ? "bull"
            : value < 50
              ? "bear"
              : "neutral",
      label:
        value >= 70
          ? "≥70：動能偏熱"
          : value <= 30
            ? "≤30：動能偏弱"
            : value > 50
              ? "50～70：動能偏強"
              : value < 50
                ? "30～50：動能偏弱"
                : "動能中性",
      attention:
        "看上漲與下跌動能。強勢趨勢可能長時間維持高 RSI，弱勢也可能持續低檔；偏熱不等於立即下跌，偏弱不等於立即反彈。",
    };
  if (["macd", "macd_signal", "macd_histogram"].includes(key)) {
    const gap =
      a.macd != null && a.macd_signal != null ? a.macd - a.macd_signal : null;
    return {
      tone:
        gap == null
          ? "neutral"
          : gap > 0
            ? "bull"
            : gap < 0
              ? "bear"
              : "neutral",
      label:
        gap == null
          ? "訊號線仍在暖機"
          : gap > 0
            ? "MACD 高於訊號線"
            : gap < 0
              ? "MACD 低於訊號線"
              : "兩線相同",
      attention:
        "看 MACD 與訊號線的位置、零軸和動能柱變化。高於訊號線只表示相對動能；仍可能在零軸下方，盤整時交叉容易失效。",
    };
  }
  if (key === "k" || key === "d")
    return {
      tone:
        value >= 80 || value <= 20
          ? "watch"
          : a.k != null && a.d != null
            ? a.k > a.d
              ? "bull"
              : a.k < a.d
                ? "bear"
                : "neutral"
            : "neutral",
      label:
        value >= 80
          ? "≥80：高檔區"
          : value <= 20
            ? "≤20：低檔區"
            : a.k > a.d
              ? "K 高於 D"
              : a.k < a.d
                ? "K 低於 D"
                : "K、D 相同",
      attention:
        "看近期收盤價在高低區間的位置，以及 K／D 相對位置。強趨勢可能高檔或低檔鈍化；單看超買超賣不能確認反轉。",
    };
  if (key === "atr14")
    return {
      tone: "neutral",
      label: `平均波幅約占收盤 ${fmt((value / row.close) * 100)}%`,
      attention:
        "ATR 衡量波動，不判斷漲跌方向。用來評估風險距離，應搭配部位大小與成交成本；不同價格股票比較時看百分比，不能只比 ATR 絕對數值。",
    };
  if (key === "volume_ratio")
    return {
      tone: value >= 1.5 ? "watch" : "neutral",
      label:
        value >= 1.5
          ? `放量 ${fmt(value)} 倍`
          : value < 1
            ? `低於前期均量：${fmt(value)} 倍`
            : `接近前期均量：${fmt(value)} 倍`,
      attention:
        "看量能是否支持價格突破。放量也可能出現在下跌；此分鐘量比是前 20 根分鐘 K 比較，不是不同交易日同時刻量比。",
    };
  return {
    tone: "neutral",
    label: "觀察數值變化",
    attention: "搭配價格、成交量及相同週期比較。",
  };
}

function technicalSummary(row) {
  const a = row?.analysis;
  if (!row)
    return {
      label: "等待資料",
      action: "此區間沒有可判讀的 K 線，請確認日期與資料來源。",
      reasons: [],
    };
  if (!row.is_final)
    return {
      label: "K 線未完成",
      action: "這根 K 線尚未收定，暫不產生正式建議。",
      reasons: [],
    };
  if (a?.ma5 == null || a?.ma20 == null)
    return {
      label: "資料不足",
      action: "均線暖機資料不足，暫時觀望，不能把缺值當成買入訊號。",
      reasons: [],
    };
  const strong = row.close > a.ma5 && a.ma5 > a.ma20;
  const weak = row.close < a.ma5 && a.ma5 < a.ma20;
  const breakout =
    a.prior_high20 != null &&
    row.close > a.prior_high20 &&
    a.volume_ratio >= 1.5;
  let label = "盤整，先觀望",
    action = `等待價格與均線方向一致；留意 MA20 ${fmt(a.ma20)} 元的得失。`;
  if (weak || (row.close < a.ma20 && a.macd_histogram < 0)) {
    label = "偏弱，優先控風險";
    action = `暫不新增部位；已持有者留意價格能否收復 MA20 ${fmt(a.ma20)} 元，再評估續抱。`;
  } else if (a.rsi14 >= 70) {
    label = "偏熱，暫不追價";
    action = `等待回檔或整理；先觀察 MA5 ${fmt(a.ma5)} 元是否守住，不能因為上漲就直接追買。`;
  } else if (
    strong &&
    breakout &&
    a.macd_histogram > 0 &&
    a.k > a.d &&
    a.rsi14 >= 50 &&
    a.rsi14 < 70 &&
    a.atr14 > 0 &&
    row.close > 2 * a.atr14
  ) {
    label = "技術進場候選";
    action =
      "趨勢、量價與動能條件一致，可列入進場觀察；仍需確認基本面與風險，不等於立即買入。";
  } else if (strong) {
    label = "偏強，等待確認";
    action = `等待回檔守住均線或突破時量能確認；MA5 ${fmt(a.ma5)} 元、MA20 ${fmt(a.ma20)} 元是觀察位置。`;
  } else if (a.ma5 > a.ma20 && row.close > a.ma20) {
    label = "多頭回檔，等待止穩";
    action = `價格仍在 MA20 ${fmt(a.ma20)} 元之上，但未站穩 MA5 ${fmt(a.ma5)} 元；等待重新站回短均線，再確認動能與量能。`;
  } else if (a.rsi14 != null && a.rsi14 <= 30) {
    label = "偏弱，先不抄底";
    action = "超賣本身不是反轉訊號，等待價格與動能止穩。";
  }
  const reasons = [
    `收盤 ${fmt(row.close)} 元，${row.close > a.ma5 ? "高於" : "低於或等於"} MA5 ${fmt(a.ma5)} 元，${row.close > a.ma20 ? "高於" : "低於或等於"} MA20 ${fmt(a.ma20)} 元。`,
    a.rsi14 == null
      ? "RSI 暖機資料不足。"
      : `RSI ${fmt(a.rsi14)}：${a.rsi14 >= 70 ? "偏熱" : a.rsi14 <= 30 ? "偏弱" : "未達過熱／超賣門檻"}。`,
    a.macd_histogram == null
      ? "MACD 動能資料不足。"
      : `MACD 柱 ${signed(a.macd_histogram)}：${a.macd_histogram > 0 ? "正動能" : a.macd_histogram < 0 ? "負動能" : "中性"}；K ${fmt(a.k)}／D ${fmt(a.d)}。`,
    a.volume_ratio == null
      ? "前 20 根成交量資料不足，無法確認量能。"
      : `量比 ${fmt(a.volume_ratio)} 倍；${breakout ? "已放量突破前 20 根高點" : "未同時滿足前 20 根高點突破與量比 ≥ 1.5"}。`,
  ];
  return { label, action, reasons };
}

export function renderSectionContext() {
  $("sectionContext").textContent =
    $("dashboardGrid").dataset.view === "indices"
      ? "大盤市場 · 加權指數／台指期日盤／夜盤"
      : `${state.stock.name || state.stock.symbol} ${state.stock.symbol} · ${periodLabel()} K · ${state.range?.start || ""} 至 ${state.range?.end || ""}`;
}
function renderAnalysis() {
  renderSectionContext();
  const last = state.selected || completed().at(-1),
    a = last?.analysis;
  renderQuickMetrics(last);
  $("metrics").replaceChildren();
  indicatorDefinitions.forEach(([key, title, description]) => {
    const div = document.createElement("div");
    const interpretation = interpretIndicator(key, last);
    div.className = "metric tone-" + interpretation.tone;
    const label = document.createElement("label");
    label.textContent =
      state.resolution === "1d"
        ? title
        : /^ma\d+$/.test(key)
          ? `MA${key.slice(2)}（${key.slice(2)} 期）`
          : title;
    const value = document.createElement("strong");
    value.textContent = fmt(a?.[key]);
    const detail = document.createElement("small");
    detail.textContent =
      state.resolution === "1d"
        ? description
        : description
            .replaceAll("日 K", `${periodLabel()} K`)
            .replace("每日", "每期");
    div.title = description;
    div.append(label, value, detail);
    const badge = document.createElement("span");
    badge.className = "metric-badge";
    badge.textContent = interpretation.label;
    const guidance = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "怎麼看／注意事項";
    const paragraph = document.createElement("p");
    paragraph.textContent = interpretation.attention;
    guidance.append(summary, paragraph);
    div.append(badge, guidance);
    $("metrics").append(div);
  });
  $("indicatorDate").textContent = last
    ? "依據 " +
      (isMinute() ? localTime(last.timestamp) : last.trade_date) +
      ` ${last.is_final ? "完成" : "未完成"} ${periodLabel()} K`
    : "等待歷史日線";
  $("indicatorNote").textContent =
    $("priceBasis").value === "raw"
      ? "原始價格：除權息或分割可能造成均線與動能跳動。資料不足的指標留空。"
      : "還原價格：已調整除權息或分割；不代表實際可成交價格。資料不足的指標留空。";
  if (typeof analysisChanged === "function") analysisChanged();
}

function renderHistory() {
  $("historyRows").replaceChildren();
  $("historyVolumeHead").textContent =
    `成交量（${$("volumeUnit").value === "lots" ? "張" : "股"}）`;
  state.rows
    .slice(-20)
    .reverse()
    .forEach((row) => {
      const tr = document.createElement("tr");
      [
        row.trade_date,
        fmt(row.open),
        fmt(row.high),
        fmt(row.low),
        fmt(row.close),
        amount(row.volume),
        fmt(row.analysis?.ma5),
        fmt(row.analysis?.ma20),
      ].forEach((v) => textCell(tr, v));
      tr.onclick = () => selectBar(row);
      $("historyRows").append(tr);
    });
}

function svgNode(name, attrs = {}) {
  const n = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
  return n;
}

function svgText(svg, text, x, y, attrs = {}) {
  const n = svgNode("text", {
    x,
    y,
    fill: "#8497b2",
    "font-size": 12,
    ...attrs,
  });
  n.textContent = text;
  svg.append(n);
}

function renderLegend() {
  $("maLegend").replaceChildren();
  if (state.chart !== "daily") return;
  maPeriods.forEach((period, i) => {
    const button = document.createElement("button");
    button.className = state.shownMAs.has(period) ? "" : "off";
    button.title = `切換 ${period} 期均線`;
    button.setAttribute("aria-pressed", state.shownMAs.has(period));
    const line = document.createElement("i");
    line.style.background = colors[i % colors.length];
    const label = document.createElement("span");
    label.textContent =
      state.resolution === "1d"
        ? `${period} 日均線`
        : `MA${period}（${period} 期）`;
    button.append(line, label);
    button.onclick = () => {
      if (state.shownMAs.has(period)) state.shownMAs.delete(period);
      else state.shownMAs.add(period);
      plot();
    };
    $("maLegend").append(button);
  });
}

function plot() {
  renderLegend();
  const svg = $("chart");
  if (globalThis.innerWidth >= 1024 && !$("chartPanel").hidden) {
    const panel = $("chartPanel").getBoundingClientRect();
    const chrome = panel.height - svg.getBoundingClientRect().height;
    svg.style.height =
      Math.max(
        360,
        Math.min(620, innerHeight - (panel.top + scrollY) - chrome - 12),
      ) + "px";
  } else svg.style.height = "";
  const chartWidth = Math.max(240, svg.getBoundingClientRect().width || 1100);
  const chartHeight = svg.getBoundingClientRect().height || 560;
  svg.setAttribute("viewBox", `0 0 ${chartWidth} ${chartHeight}`);
  svg.replaceChildren();
  $("chartTooltip").hidden = true;
  chartState = null;
  const intraday = state.chart === "intraday";
  const allRows = intraday
    ? state.points.filter((p) => p.last_price != null)
    : state.rows;
  const count = Math.max(
    1,
    Math.min(allRows.length || 1, state.viewport.count || allRows.length || 1),
  );
  state.viewport.start = Math.max(
    0,
    Math.min(state.viewport.start, Math.max(0, allRows.length - count)),
  );
  const rows = allRows.slice(
    state.viewport.start,
    state.viewport.start + count,
  );
  if (!rows.length) {
    svgText(
      svg,
      intraday
        ? "尚未收集這個交易日的分時快照"
        : "正在載入股票歷史，或此區間無資料",
      chartWidth / 2,
      chartHeight * 0.4,
      { "text-anchor": "middle", "font-size": 16 },
    );
    svgText(
      svg,
      intraday
        ? "開始查看後逐次累積，不以日線假造分鐘走勢"
        : isMinute()
          ? "分鐘 K 需要授權分鐘來源；報價快照不冒充 K 線"
          : "可輸入其他股票或調整日期區間",
      chartWidth / 2,
      chartHeight * 0.4 + 30,
      { "text-anchor": "middle" },
    );
    $("chartDescription").textContent = intraday
      ? "公開快照觀測走勢，不是完整逐筆或分鐘 K 線。"
      : "歷史日 K 與完成日線的均線。";
    return;
  }
  const hasSub = !intraday && $("subIndicator").value !== "none";
  const left = 86,
    right = chartWidth - 24,
    top = 24,
    bottom = chartHeight - (hasSub ? 180 : 110),
    volumeTop = bottom + 30,
    volumeBottom = chartHeight - (hasSub ? 95 : 35);
  const priceValues = intraday
    ? rows.map((r) => r.last_price)
    : rows.flatMap((r) => [
        r.low,
        r.high,
        ...($("showBollinger").checked
          ? [r.analysis?.bb_upper, r.analysis?.bb_lower].filter(
              (v) => v != null,
            )
          : []),
        ...maPeriods
          .filter((p) => state.shownMAs.has(p))
          .map((p) => maValue(r, p))
          .filter((v) => v != null),
      ]);
  let low = Math.min(...priceValues),
    high = Math.max(...priceValues);
  const pad = (high - low) * 0.08 || Math.max(0.1, high * 0.002);
  low -= pad;
  high += pad;
  const y = (p) => bottom - ((p - low) / (high - low)) * (bottom - top);
  let x;
  if (intraday) {
    const times = rows.map((r) => new Date(r.source_time).getTime());
    const first = new Date(rows[0].trade_date + "T09:00:00+08:00").getTime(),
      last = Math.max(
        new Date(rows[0].trade_date + "T13:30:00+08:00").getTime(),
        ...times,
      );
    x = (i) => left + ((times[i] - first) / (last - first)) * (right - left);
  } else x = (i) => left + ((i + 0.5) / rows.length) * (right - left);
  for (let i = 0; i <= 4; i++) {
    const price = low + ((high - low) * i) / 4,
      Y = y(price);
    svg.append(
      svgNode("line", {
        x1: left,
        x2: right,
        y1: Y,
        y2: Y,
        stroke: "#253249",
        "stroke-dasharray": "3 5",
      }),
    );
    svgText(svg, fmt(price), left - 10, Y + 4, { "text-anchor": "end" });
  }
  svg.append(
    svgNode("line", {
      x1: left,
      x2: right,
      y1: volumeTop - 12,
      y2: volumeTop - 12,
      stroke: "#27354a",
    }),
  );
  svgText(
    svg,
    intraday
      ? "累計量"
      : $("volumeUnit").value === "lots"
        ? "成交量（張）"
        : "成交量（股）",
    left - 10,
    volumeTop + 9,
    { "text-anchor": "end", class: "volume-axis-title" },
  );
  const volumes = rows.map((r) => (intraday ? r.volume_shares : r.volume));
  const maxVolume = Math.max(1, ...volumes.filter((v) => v != null));
  const axisVolume =
    $("volumeUnit").value === "lots" ? maxVolume / 1000 : maxVolume;
  svgText(
    svg,
    new Intl.NumberFormat("zh-TW", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(axisVolume),
    left - 10,
    volumeBottom,
    {
      "text-anchor": "end",
      "font-size": 10,
    },
  );
  if (intraday) {
    let path = "";
    rows.forEach((r, i) => {
      path += (i ? "L" : "M") + x(i) + "," + y(r.last_price) + " ";
    });
    svg.append(
      svgNode("path", {
        d: path,
        fill: "none",
        stroke: "#78b8ff",
        "stroke-width": 2,
      }),
    );
    rows.forEach((r, i) =>
      svg.append(
        svgNode("circle", {
          cx: x(i),
          cy: y(r.last_price),
          r: rows.length === 1 ? 4 : 2,
          fill: "#78b8ff",
        }),
      ),
    );
  } else {
    const width = Math.max(
      0.6,
      Math.min(10, ((right - left) / rows.length) * 0.65),
    );
    rows.forEach((r, i) => {
      const color = r.close >= r.open ? "#f87180" : "#4dd1a2";
      svg.append(
        svgNode("line", {
          x1: x(i),
          x2: x(i),
          y1: y(r.high),
          y2: y(r.low),
          stroke: color,
        }),
      );
      svg.append(
        svgNode("rect", {
          x: x(i) - width / 2,
          y: Math.min(y(r.open), y(r.close)),
          width,
          height: Math.max(1, Math.abs(y(r.open) - y(r.close))),
          fill: color,
          opacity: r.is_final ? 1 : 0.35,
        }),
      );
    });
    maPeriods.forEach((p, j) => {
      if (!state.shownMAs.has(p)) return;
      let path = "",
        active = false;
      rows.forEach((r, i) => {
        const value = maValue(r, p);
        if (value == null) {
          active = false;
          return;
        }
        path += (active ? "L" : "M") + x(i) + "," + y(value) + " ";
        active = true;
      });
      svg.append(
        svgNode("path", {
          d: path,
          fill: "none",
          stroke: colors[j % colors.length],
          "stroke-width": 1.4,
        }),
      );
    });
  }
  if (!intraday && $("showBollinger").checked) {
    ["bb_upper", "bb_lower"].forEach((field) => {
      let path = "",
        active = false;
      rows.forEach((r, i) => {
        const value = r.analysis?.[field];
        if (value == null) {
          active = false;
          return;
        }
        path += (active ? "L" : "M") + x(i) + "," + y(value) + " ";
        active = true;
      });
      svg.append(
        svgNode("path", {
          d: path,
          fill: "none",
          stroke: "#91b9a6",
          "stroke-dasharray": "5 3",
          "data-bollinger": field,
        }),
      );
    });
  }
  if (!intraday && $("showSignals").checked)
    rows.forEach((r, i) => {
      if (!r.is_final || !r.signals?.length) return;
      const rising = !r.signals.some((signal) => signal.includes("下穿"));
      const marker = svgNode("path", {
        d: rising
          ? `M${x(i)},${y(r.low) + 7} l-5,8 h10 z`
          : `M${x(i)},${y(r.high) - 7} l-5,-8 h10 z`,
        fill: rising ? "#f0c26c" : "#bf9cfc",
        "data-signal": r.signals.join("、"),
      });
      const title = svgNode("title");
      title.textContent = `${r.trade_date}：${r.signals.join("、")}`;
      marker.append(title);
      svg.append(marker);
    });
  rows.forEach((r, i) => {
    const volume = volumes[i];
    if (volume == null) return;
    const height = (volume / maxVolume) * (volumeBottom - volumeTop);
    svg.append(
      svgNode("rect", {
        x: x(i) - 2,
        y: volumeBottom - height,
        width: Math.max(1, Math.min(8, ((right - left) / rows.length) * 0.6)),
        height,
        fill: intraday ? "#496c99" : r.close >= r.open ? "#995361" : "#3f8272",
        opacity: 0.8,
      }),
    );
  });
  const indices = [
    ...new Set([
      0,
      ...(chartWidth < 480
        ? []
        : [
            Math.floor((rows.length - 1) / 3),
            Math.floor(((rows.length - 1) * 2) / 3),
          ]),
      rows.length - 1,
    ]),
  ];
  indices.forEach((i) =>
    svgText(
      svg,
      intraday
        ? new Date(rows[i].source_time).toLocaleTimeString("zh-TW", {
            timeZone: "Asia/Taipei",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })
        : isMinute()
          ? localTime(rows[i].timestamp).slice(5)
          : rows[i].trade_date,
      x(i),
      volumeBottom + 20,
      {
        "text-anchor":
          i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle",
      },
    ),
  );
  chartState = { rows, x, y, left, right, svg, intraday, chartWidth };
  if (!intraday) plotSubIndicator(svg, rows, x, left, right, chartHeight);
  const cross = svgNode("line", {
    id: "crosshair",
    x1: 0,
    x2: 0,
    y1: top,
    y2: volumeBottom,
    stroke: "#8ba6c6",
    "stroke-dasharray": "4 4",
    visibility: "hidden",
  });
  svg.append(cross);
  $("chartDescription").textContent = intraday
    ? `${rows[0].trade_date} · ${rows.length} 個公開快照觀測點，開始查看前的走勢不補造。`
    : `${rows[0].trade_date} 至 ${rows.at(-1).trade_date} · 顯示 ${rows.length}／${allRows.length} 根 ${periodLabel()} K · 均線只用完成 K 線計算。`;
}

function maValue(row, period) {
  return row.analysis?.["ma" + period];
}

function plotSubIndicator(svg, rows, x, left, right, chartHeight) {
  const kind = $("subIndicator").value;
  if (kind === "none") return;
  const fields =
    kind === "kd"
      ? ["k", "d"]
      : kind === "macd"
        ? ["macd", "macd_signal"]
        : ["rsi14"];
  const values = rows
    .flatMap((r) =>
      [...fields, ...(kind === "macd" ? ["macd_histogram"] : [])].map(
        (k) => r.analysis?.[k],
      ),
    )
    .filter((v) => v != null);
  if (!values.length) {
    svgText(
      svg,
      `${kind.toUpperCase()}：完成 K 線不足，指標暖機中`,
      left,
      chartHeight * 0.9,
    );
    return;
  }
  let lo = kind === "macd" ? Math.min(0, ...values) : 0,
    hi = kind === "macd" ? Math.max(0, ...values) : 100;
  if (hi === lo) hi = lo + 1;
  const y = (v) => chartHeight - 15 - ((v - lo) / (hi - lo)) * 45;
  svgText(svg, kind.toUpperCase(), left - 10, chartHeight - 65, {
    "text-anchor": "end",
  });
  (kind === "macd" ? [0] : kind === "kd" ? [20, 80] : [30, 70]).forEach((v) => {
    svg.append(
      svgNode("line", {
        x1: left,
        x2: right,
        y1: y(v),
        y2: y(v),
        stroke: "#354762",
        "stroke-dasharray": "3 4",
      }),
    );
    svgText(svg, fmt(v), left - 10, y(v) + 4, { "text-anchor": "end" });
  });
  if (kind === "macd")
    rows.forEach((r, i) => {
      const v = r.analysis?.macd_histogram;
      if (v == null) return;
      svg.append(
        svgNode("rect", {
          x: x(i) - 2,
          y: Math.min(y(0), y(v)),
          width: 4,
          height: Math.max(1, Math.abs(y(v) - y(0))),
          fill: v >= 0 ? "#f87180" : "#4dd1a2",
        }),
      );
    });
  fields.forEach((field, j) => {
    let path = "",
      active = false;
    rows.forEach((r, i) => {
      const v = r.analysis?.[field];
      if (v == null) {
        active = false;
        return;
      }
      path += (active ? "L" : "M") + x(i) + "," + y(v) + " ";
      active = true;
    });
    svg.append(
      svgNode("path", {
        d: path,
        fill: "none",
        stroke: colors[j],
        "stroke-width": 1.5,
      }),
    );
  });
}

function updateRangeSelection() {
  if (
    state.rangePreset !== null &&
    (state.presetRange?.start !== state.range.start ||
      state.presetRange?.end !== state.range.end)
  )
    state.rangePreset = null;
  const preset = state.rangePreset;
  document.querySelectorAll("[data-days]").forEach((b) => {
    const active = preset !== null && Number(b.dataset.days) === preset;
    b.classList.toggle("selected", active);
    b.setAttribute("aria-pressed", active);
  });
  $("rangeSelection").textContent =
    `${preset === null ? "自訂區間" : `近 ${preset + 1} 個交易日`} · ${state.range.start} 至 ${state.range.end}（含首尾日）。快捷區間排除週末與公告休市日；缺行情／個股停牌不補造 K 線。`;
}

function updatePeriodHelp() {
  const minute = isMinute();
  $("periodHelp").textContent = minute
    ? "分鐘／小時 K 按起始至截止日期查詢（含首尾日），最多 31 日；分鐘歷史需 FinMind Sponsor 權限，今日需盤中分鐘行情來源。"
    : `${periodLabel()} K 按指定日期查詢（含首尾日）；今日完成日線尚未由盤後來源提供時不補造價格。週／月 K 可能包含區間起點之前的同一期交易日。`;
  $("startDate").min = minute ? "2019-01-01" : "1994-10-01";
  $("endDate").max = taipeiDay();
  document.querySelectorAll("[data-days]").forEach((b) => {
    b.disabled = minute && Number(b.dataset.days) > 30;
  });
}

function updateRangeStatus() {
  const { start, end } = state.range,
    first = state.rows[0],
    last = state.rows.at(-1);
  $("rangeStatus").textContent =
    `查詢 ${start} 至 ${end} · ${periodLabel()} K · ${state.rows.length} 根` +
    (first
      ? ` · 實際資料 ${isMinute() ? localTime(first.timestamp) : first.trade_date} 至 ${isMinute() ? localTime(last.timestamp) : last.trade_date}`
      : " · 尚無該範圍資料，請查看載入狀態／來源權限。");
}

function renderMonitorStatus() {
  $("connectionState").textContent = !state.market
    ? "確認市場"
    : !state.market.monitor_allowed
      ? "休市／盤外"
      : !$("autoRefresh").checked
        ? "手動更新"
        : state.quote &&
            ["previous_session", "delayed", "unavailable"].includes(
              state.quote.state,
            )
          ? "行情延遲"
          : "盤中監控";
  document
    .querySelector(".connection-chip")
    ?.classList.toggle(
      "is-active",
      !!(
        state.market?.monitor_allowed &&
        $("autoRefresh").checked &&
        state.quote?.state === "snapshot"
      ),
    );
  const selected = $("autoRefresh").checked;
  $("monitorStatus").textContent = !selected
    ? "即時監控未開啟；可查詢歷史區間或手動更新最近快照。"
    : !state.market
      ? "確認交易日與時段中…"
      : !state.market.monitor_allowed
        ? `已勾選監控，暫停更新：${state.market.reason}。下一交易時段自動恢復。`
        : state.quote &&
            (state.quote.trade_date !== taipeiDay() ||
              ["previous_session", "delayed", "unavailable"].includes(
                state.quote.state,
              ))
          ? "交易時段內，但行情延遲／非今日資料；持續檢查，畫面不視為即時成交。"
          : "盤中監控已開啟，按設定間隔更新行情、五檔與已接入的分鐘 K。";
}

function renderQuickMetrics(row) {
  const a = row?.analysis;
  $("quickMetrics").replaceChildren();
  const definitions = [
    ["ma5", "MA5", "五期均線"],
    ["ma20", "MA20", "二十期均線"],
    ["rsi14", "RSI 14", "相對強弱"],
    ["macd_histogram", "MACD", "動能柱"],
    ["k", "KD", "K / D"],
    ["volume_ratio", "成交量比", "前 20 期量能"],
  ];
  definitions.forEach(([key, label, description]) => {
    const interpretation = interpretIndicator(key, row);
    const card = document.createElement("div");
    card.className = "quick-metric tone-" + interpretation.tone;
    const title = document.createElement("label");
    title.textContent = label;
    const value = document.createElement("strong");
    value.textContent =
      key === "k" ? `${fmt(a?.k)} / ${fmt(a?.d)}` : fmt(a?.[key]);
    const note = document.createElement("small");
    note.textContent = description;
    card.title = interpretation.label + " · " + interpretation.attention;
    card.append(title, value, note);
    $("quickMetrics").append(card);
  });
}

function clock() {
  $("clock").textContent = new Date().toLocaleTimeString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour12: false,
  });
  $("marketStatus").textContent =
    taipeiDay() + " · " + (state.market?.reason || "確認市場日曆中");
}

function metricCard(container, title, value, detail) {
  const card = document.createElement("div");
  card.className = "metric";
  const label = document.createElement("label");
  label.textContent = title;
  const number = document.createElement("strong");
  number.textContent = value;
  const note = document.createElement("small");
  note.textContent = detail;
  card.append(label, number, note);
  container.append(card);
}

function renderFinancialDetails(data, historical, params) {
  $("financialStatus").textContent =
    `${historical ? "歷史當時可得" : "最新取得修訂"} · 截止 ${localTime(data.as_of)} · 財報期間依各指標標示`;
  $("financialStatus").title = data.note;
  $("financialMetrics").replaceChildren();
  if (typeof renderFinancialResearch === "function")
    renderFinancialResearch(data);
  else
    data.metrics.forEach((m) =>
      metricCard(
        $("financialMetrics"),
        m.label,
        fmt(m.value) + " " + m.unit,
        `${m.period} · ${m.note}`,
      ),
    );
  $("financialCoverage").textContent = data.coverage
    .map(
      (s) =>
        `${s.label}：${s.status === "available" ? "已取得／修訂 " + s.revision + "／接收 " + localTime(s.received_at) : "未取得或此時尚不可用"}`,
    )
    .join("；");
  $("revenueRows").replaceChildren();
  data.revenue_history
    .slice()
    .reverse()
    .forEach((r) => {
      const tr = document.createElement("tr");
      textCell(tr, r.period);
      textCell(tr, fmt(r.value));
      $("revenueRows").append(tr);
    });
  $("financialPeriods").textContent =
    `損益表 ${data.statement_periods.income || "—"} · 資產負債表 ${data.statement_periods.balance || "—"} · 現金流量表 ${data.statement_periods.cash || "—"}。`;
  $("financialRaw").href =
    `/api/fundamentals/${state.stock.market}/${state.stock.symbol}${params}${params ? "&" : "?"}include_raw=true`;
}

function renderBacktestResult(data) {
  $("backtestMetrics").replaceChildren();
  $("backtestTrades").replaceChildren();
  const fields = [
    ["return_percent", "策略區間報酬", "%"],
    ["max_drawdown_percent", "收盤最大回撤", "%"],
    ["win_rate_percent", "已平倉勝率", "%"],
    ["closed_trades", "已平倉交易數", "筆"],
    ["buy_hold_price_return_percent", "持有價格報酬（未扣成本）", "%"],
  ];
  fields.forEach(([field, label, unit]) =>
    metricCard(
      $("backtestMetrics"),
      label,
      fmt(data[field]) + unit,
      data.version,
    ),
  );
  data.trades
    .slice(-100)
    .reverse()
    .forEach((t) => {
      const tr = document.createElement("tr");
      [
        localTime(t.entry_timestamp),
        localTime(t.exit_timestamp),
        fmt(t.entry),
        fmt(t.exit),
        signed(t.return_percent, "%"),
        t.reason,
      ].forEach((v) => textCell(tr, v));
      $("backtestTrades").append(tr);
    });
  $("backtestStatus").textContent =
    `${state.range.start} 至 ${state.range.end} · ${data.bars} 根完成 ${periodLabel()} K · ${data.price_basis === "raw" ? "原始價試算：未處理除權息與股利" : "還原價研究"} · ${data.status === "insufficient_data" ? "資料不足" : data.status === "no_trades" ? "無已平倉交易，不能推論勝率" : "固定規則研究結果"} · ${data.open_position ? "期末仍有未平倉部位" : "期末無持倉"}。`;
  $("backtestNotes").textContent = data.limitations.join(" ");
}

export function initDashboardView() {}

export {
  $,
  fmt,
  localTime,
  colors,
  chartState,
  indicatorDefinitions,
  message,
  amount,
  signed,
  paintPrice,
  textCell,
  emptyQuote,
  renderFavorites,
  closeSuggestions,
  renderQuote,
  renderBook,
  periodLabel,
  historyResult,
  renderHistoricalSummary,
  interpretIndicator,
  technicalSummary,
  renderAnalysis,
  renderHistory,
  svgNode,
  svgText,
  renderLegend,
  plot,
  maValue,
  plotSubIndicator,
  updateRangeSelection,
  updatePeriodHelp,
  updateRangeStatus,
  renderMonitorStatus,
  renderQuickMetrics,
  clock,
  metricCard,
  renderFinancialDetails,
  renderBacktestResult,
};
