import { renderOrderbook } from "../views/orderbook-view.js";
import { aggregateBoardMinutes } from "../models/market-board-model.js";
import { $ } from "../views/dashboard-view.js";
import { closeMetrics } from "../models/market-technical-model.js";
import { initMarketChips, loadMarketChips } from "./market-chips-controller.js";

const board = {
  product: "index",
  quotes: [],
  result: null,
  version: 0,
  start: 0,
  count: 0,
  dragging: null,
  tab: "live",
};
const format = (v, digits = 2) =>
  v == null
    ? "—"
    : Number(v).toLocaleString("zh-TW", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      });
const active = () => $("dashboardGrid").dataset.view === "indices";
const historical = () => $("boardMode").value === "history";
const chosenQuote = () =>
  board.quotes.find(
    (q) =>
      q.session === board.product &&
      (board.product === "index" || q.symbol === $("boardContract").value),
  );
function element(tag, text, className) {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  if (className) e.className = className;
  return e;
}
async function json(path, signal) {
  const response = await fetch(path, { signal });
  const data = await response.json();
  if (!response.ok) throw Error(data.detail || "市場資料暫時無法取得");
  return data;
}
function contracts() {
  const old = $("boardContract").value;
  const items = board.quotes
    .filter((q) => q.session === board.product)
    .sort((a, b) =>
      (a.contract_month || "").localeCompare(b.contract_month || ""),
    );
  $("boardContract").replaceChildren(
    ...items.map((q) => {
      const option = element(
        "option",
        q.contract_month
          ? `${q.contract_month.slice(0, 4)}/${q.contract_month.slice(4)}`
          : q.name,
      );
      option.value = q.symbol;
      return option;
    }),
  );
  if (items.some((q) => q.symbol === old)) $("boardContract").value = old;
  if (!$("boardExpiry").value && items[0]?.contract_month)
    $("boardExpiry").value =
      items[0].contract_month.slice(0, 4) +
      "-" +
      items[0].contract_month.slice(4);
}
function cards() {
  $("marketBoardCards").replaceChildren();
  for (const [product, title] of [
    ["index", "加權指數"],
    ["day", "台指期日盤"],
    ["night", "台指期夜盤"],
  ]) {
    const candidates = board.quotes
      .filter((q) => q.session === product)
      .sort((a, b) =>
        (a.contract_month || "").localeCompare(b.contract_month || ""),
      );
    const q = product === board.product ? chosenQuote() : candidates[0];
    const button = element("button", null, "market-board-card");
    button.type = "button";
    button.dataset.product = product;
    button.setAttribute("aria-pressed", String(board.product === product));
    button.title = q
      ? `${title} · ${q.contract_month || "現貨指數"} · ${q.source_date || "日期未提供"} · ${q.status === "closed" ? "最近收盤" : "公開快照"}`
      : "來源暫時無法取得";
    const tone =
      q?.change > 0 ? "tone-bull" : q?.change < 0 ? "tone-bear" : "muted";
    button.append(
      element("span", title),
      element("strong", format(q?.last_price), tone),
      element(
        "span",
        q?.change == null
          ? "尚無資料"
          : `${q.change > 0 ? "+" : ""}${format(q.change)}（${format(q.change_percent)}%）`,
        tone,
      ),
      element(
        "small",
        q
          ? `${q.source_date?.slice(5).replace("-", "/") || "日期未提供"} · ${q.status === "closed" ? "收盤" : "快照"}`
          : "來源暫時無法取得",
      ),
    );
    button.onclick = () => {
      board.product = product;
      $("boardExpiry").value = "";
      contracts();
      updateControls();
      cards();
      refreshChart();
    };
    $("marketBoardCards").append(button);
  }
}
function updateControls() {
  renderBook();
  $("boardMode").closest("label").hidden = true;
  $("boardContractLabel").hidden = board.product === "index" || historical();
  $("boardExpiryLabel").hidden = board.product === "index" || !historical();
  $("boardResolutionLabel").hidden = historical();
  $("boardRangeForm").hidden = !historical();
  $("boardMonitor").disabled = historical();
  if (historical()) $("boardMonitor").checked = false;
  const closeOnly = historical() && board.product === "index";
  $("boardChartType").querySelector('[value="candle"]').disabled = closeOnly;
  if (closeOnly) $("boardChartType").value = "line";
}

function plotted() {
  const data = board.result?.data || [];
  return historical()
    ? data
    : aggregateBoardMinutes(
        data,
        Number($("boardResolution").value),
        board.result?.status === "closed",
      );
}
function renderBook() {
  const show =
    !historical() && board.product !== "index" && board.tab === "live";
  $("boardOrderbook").hidden = !show;
  document
    .querySelector(".market-board-layout")
    .classList.toggle("with-orderbook", show);
  if (!show) {
    $("boardBookRows").replaceChildren();
    $("boardBookBalance").replaceChildren();
    return;
  }
  const q =
    !historical() &&
    board.result?.session === board.product &&
    board.result.symbol === chosenQuote()?.symbol
      ? board.result
      : null;
  $("boardBookBadge").textContent = q ? "公開快照" : "等待行情";
  $("boardBookTime").textContent =
    (board.product === "night" ? "台指期夜盤" : "台指期日盤") +
    " · 數量單位：口";
  renderOrderbook({
    rows: $("boardBookRows"),
    balance: $("boardBookBalance"),
    quote: q,
    volumeKey: "volume",
    quantity: (value) => format(value, 0),
    price: (value) => format(value, 0),
  });
}

function renderStatistics() {
  const q = board.result;
  const last = q?.data?.at(-1);
  const values = historical()
    ? board.product === "index"
      ? [
          ["區間最後日期", last?.label],
          ["收盤指數", last?.close],
          ["漲跌點數", last?.change],
          ["成交量（億股）", last?.volume == null ? null : last.volume / 1e8],
          [
            "成交金額（億元）",
            last?.turnover == null ? null : last.turnover / 1e8,
          ],
        ]
      : [
          ["區間最後日期", last?.label],
          ["開盤", last?.open],
          ["最高", last?.high],
          ["最低", last?.low],
          ["收盤", last?.close],
          [
            board.product === "index" ? "成交量（股）" : "成交量（口）",
            last?.volume,
          ],
        ]
    : [
        ["開盤", q?.open],
        ["最高", q?.high],
        ["最低", q?.low],
        ["本盤參考價", q?.reference_price],
        ["成交量（口）", q?.volume],
        ["未平倉（口）", q?.open_interest],
      ];
  $("boardQuoteMetrics").replaceChildren(
    ...values
      .filter(
        ([title]) =>
          !(board.product === "index" && !historical() && /口/.test(title)),
      )
      .map(([title, value]) => {
        const node = element("div");
        if (historical() && board.product === "index" && /成交/.test(title))
          node.title = /量/.test(title)
            ? `原始成交量：${format(last?.volume, 0)} 股`
            : `原始成交金額：${format(last?.turnover, 0)} 元`;
        node.append(
          element("span", title),
          element(
            "strong",
            typeof value === "string"
              ? value
              : format(
                  value,
                  /億股/.test(title)
                    ? 4
                    : /億元/.test(title)
                      ? 2
                      : /量|平倉/.test(title)
                        ? 0
                        : 2,
                ),
          ),
        );
        return node;
      }),
  );
}
function selected(row) {
  $("boardChartSelection").textContent = row
    ? `${row.label} · ${row.open == null ? "" : `開 ${format(row.open)}／高 ${format(row.high)}／低 ${format(row.low)}／`}收 ${format(row.close)}${row.volume == null ? "" : ` · 量 ${format(row.volume, 0)} ${historical() && board.product === "index" ? "股" : "口"}`} · ${row.is_final ? "完成" : "未完成"}`
    : "移動游標或點選圖表查看行情；拖曳移動、滾輪縮放。";
}
function renderTechnical() {
  const target = $("boardTechnicalMetrics");
  target.hidden = board.tab !== "technical";
  $("boardTechnicalHelp").hidden = target.hidden;
  if (target.hidden) return;
  const metrics = closeMetrics([
    ...(board.result?.warmup_data || []),
    ...plotted(),
  ]);
  target.replaceChildren();
  for (const [key, title, note] of [
    ["ma5", "MA5", "5 期平均收盤"],
    ["ma20", "MA20", "20 期平均收盤"],
    ["ma60", "MA60", "60 期平均收盤"],
    ["rsi14", "RSI14", "大於 70／小於 30 留意過熱／偏弱"],
    ["macd", "MACD", "12／26 期 EMA 差"],
    ["histogram", "MACD 柱狀值", "MACD − 9 期訊號線"],
  ]) {
    const value = metrics[key],
      tone =
        value == null
          ? "muted"
          : key === "histogram"
            ? value > 0
              ? "tone-bull"
              : value < 0
                ? "tone-bear"
                : "muted"
            : "";
    const card = element("div", null, "board-metric " + tone);
    card.title = `${title}：${note}`;
    card.append(
      element("span", title),
      element("strong", format(value)),
      element("small", value == null ? "完整期數不足" : note),
    );
    target.append(card);
  }
  $("boardTechnicalNote").textContent =
    `依 ${metrics.label || "尚無資料"} 最後完成觀測計算 · 含區間前暖機資料 ${metrics.count} 筆。MA 為指定期數收盤平均；RSI14 使用 Wilder 平滑；MACD 為 12／26 期 EMA 差，柱狀值為 MACD 減 9 期訊號線。加權日線來源僅有收盤，不顯示需要最高／最低價的 KD、ATR。`;
}
function draw() {
  renderTechnical();
  const svg = $("boardChart");
  const width = Math.max(240, svg.getBoundingClientRect().width || 800),
    height = svg.getBoundingClientRect().height || 420;
  const left = 8,
    plotWidth = width - 82,
    volumeBottom = height - 24,
    volumeHeight = Math.max(24, Math.min(55, height * 0.18)),
    priceHeight = Math.max(70, height - volumeHeight - 55);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.replaceChildren();
  const all = plotted();
  board.count = Math.min(board.count || all.length, all.length);
  board.start = Math.max(0, Math.min(board.start, all.length - board.count));
  const visible = all.slice(board.start, board.start + board.count);
  const add = (tag, attrs, text) => {
    const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text) e.textContent = text;
    svg.append(e);
    return e;
  };
  if (!visible.length) {
    add(
      "text",
      {
        x: width / 2,
        y: height / 2,
        "text-anchor": "middle",
        fill: "#9ebacf",
        "font-size": width < 500 ? 14 : 20,
      },
      "此區間尚無行情資料",
    );
    return;
  }
  const warmup = historical() ? board.result?.warmup_data || [] : [];
  const observations = [...warmup, ...all];
  const ma = (period) =>
    all.map((_, position) => {
      const i = position + warmup.length;
      return i < period - 1 ||
        observations.slice(i - period + 1, i + 1).some((r) => !r.is_final)
        ? null
        : observations
            .slice(i - period + 1, i + 1)
            .reduce((sum, r) => sum + r.close, 0) / period;
    });
  const averages = [
    [5, "#f5c967", $("boardMA5").checked],
    [20, "#66c9ed", $("boardMA20").checked],
  ].map(([period, color, on]) => ({
    period,
    color,
    on,
    data: ma(period).slice(board.start, board.start + board.count),
  }));
  const candle =
    $("boardChartType").value === "candle" && visible[0].open != null;
  const prices = visible
    .flatMap((r) => [r.close, ...(candle ? [r.high, r.low] : [])])
    .concat(
      averages
        .filter((a) => a.on)
        .flatMap((a) => a.data.filter((v) => v != null)),
    );
  const min = Math.min(...prices),
    max = Math.max(...prices),
    padding = Math.max((max - min) * 0.08, max * 0.0003),
    low = min - padding,
    high = max + padding;
  const x = (i) => left + ((i + 0.5) * plotWidth) / visible.length,
    y = (v) => 12 + ((high - v) / (high - low)) * priceHeight;
  const ticks = height < 230 ? 4 : 5;
  for (let i = 0; i < ticks; i++) {
    const v = low + ((high - low) * i) / (ticks - 1);
    add("line", {
      x1: left,
      x2: left + plotWidth,
      y1: y(v),
      y2: y(v),
      stroke: "#274459",
    });
    add(
      "text",
      {
        x: left + plotWidth + 7,
        y: y(v) + 5,
        fill: "#a9c7dc",
        "font-size": 13,
      },
      format(v, 0),
    );
  }
  const volMax = Math.max(1, ...visible.map((r) => r.volume || 0));
  visible.forEach((row, i) => {
    const color =
      row.close >= (row.open ?? visible[Math.max(0, i - 1)].close)
        ? "#ff697c"
        : "#40d6a5";
    if (row.volume != null)
      add("rect", {
        x: x(i) - Math.max(0.5, (plotWidth / visible.length) * 0.3),
        y: volumeBottom - (row.volume / volMax) * volumeHeight,
        width: Math.max(1, (plotWidth / visible.length) * 0.6),
        height: (row.volume / volMax) * volumeHeight,
        fill: color,
        opacity: 0.5,
      });
    if (candle) {
      add("line", {
        x1: x(i),
        x2: x(i),
        y1: y(row.high),
        y2: y(row.low),
        stroke: color,
      });
      add("rect", {
        x: x(i) - Math.max(0.5, (plotWidth / visible.length) * 0.3),
        y: Math.min(y(row.open), y(row.close)),
        width: Math.max(1, (plotWidth / visible.length) * 0.6),
        height: Math.max(1, Math.abs(y(row.open) - y(row.close))),
        fill: color,
        opacity: row.is_final ? 1 : 0.45,
      });
    }
  });
  if (!candle)
    add("path", {
      d: visible
        .map((r, i) => `${i ? "L" : "M"}${x(i)},${y(r.close)}`)
        .join(" "),
      fill: "none",
      stroke: "#65d5ef",
      "stroke-width": 2,
    });
  for (const avg of averages.filter((a) => a.on)) {
    let segment = false;
    const path = avg.data
      .map((v, i) => {
        if (v == null) {
          segment = false;
          return "";
        }
        const part = `${segment ? "L" : "M"}${x(i)},${y(v)}`;
        segment = true;
        return part;
      })
      .join(" ");
    if (path)
      add("path", {
        d: path,
        fill: "none",
        stroke: avg.color,
        "stroke-width": 2,
      });
  }
  for (const i of [
    ...new Set(
      width < 500
        ? [0, visible.length - 1]
        : [0, Math.floor(visible.length / 2), visible.length - 1],
    ),
  ])
    add(
      "text",
      {
        x: x(i),
        y: height - 8,
        "text-anchor":
          i === 0 ? "start" : i === visible.length - 1 ? "end" : "middle",
        fill: "#a9c7dc",
        "font-size": 13,
      },
      visible[i].label,
    );
  const cross = add("line", {
    x1: left,
    x2: left,
    y1: 30,
    y2: volumeBottom,
    stroke: "#b7dcec",
    "stroke-dasharray": "4 4",
    visibility: "hidden",
  });
  const position = (event) =>
    Math.max(
      0,
      Math.min(
        visible.length - 1,
        Math.floor(
          ((((event.clientX - svg.getBoundingClientRect().left) /
            svg.getBoundingClientRect().width) *
            width -
            left) /
            plotWidth) *
            visible.length,
        ),
      ),
    );
  svg.onpointermove = (event) => {
    if (board.dragging) {
      const distance =
        ((event.clientX - board.dragging.x) /
          svg.getBoundingClientRect().width) *
        board.count;
      board.start = Math.round(board.dragging.start - distance);
      draw();
    } else {
      const i = position(event);
      cross.setAttribute("x1", x(i));
      cross.setAttribute("x2", x(i));
      cross.setAttribute("visibility", "visible");
      selected(visible[i]);
    }
  };
  svg.onpointerleave = () => {
    if (!board.dragging) cross.setAttribute("visibility", "hidden");
  };
  svg.onpointerdown = (event) => {
    board.dragging = { x: event.clientX, start: board.start };
    svg.setPointerCapture(event.pointerId);
    selected(visible[position(event)]);
  };
  svg.onpointerup = () => {
    board.dragging = null;
  };
  svg.onpointercancel = () => {
    board.dragging = null;
  };
  svg.onwheel = (event) => {
    event.preventDefault();
    const anchor = board.start + position(event);
    const fraction = position(event) / Math.max(1, board.count);
    board.count = Math.max(
      Math.min(10, all.length),
      Math.min(
        all.length,
        Math.round(board.count * (event.deltaY > 0 ? 1.2 : 0.8)),
      ),
    );
    board.start = Math.round(anchor - fraction * board.count);
    draw();
  };
  $("boardChartCaption").textContent =
    `顯示 ${visible.length}／${all.length} 根 · ${visible[0].label} 至 ${visible.at(-1).label} · ${historical() ? "日線" : $("boardResolution").selectedOptions[0].textContent} · 均線只使用完成觀測。`;
}
let abort;
async function refreshChart(reset = true) {
  const version = ++board.version;
  abort?.abort();
  abort = new AbortController();
  const signal = abort.signal;
  const mode = historical() ? "history" : "intraday",
    params = new URLSearchParams({ product: board.product, mode });
  const q = chosenQuote();
  if (historical()) {
    params.set("start", $("boardStart").value);
    params.set("end", $("boardEnd").value);
    if (board.product !== "index")
      params.set("contract", $("boardExpiry").value.replace("-", ""));
  } else if (board.product !== "index") {
    if (!q) {
      board.result = null;
      draw();
      $("marketBoardStatus").textContent =
        "此盤別尚無可查詢契約，請稍後更新行情。";
      return;
    }
    params.set("symbol", q.symbol);
  }
  board.result = null;
  $("boardQuoteMetrics").replaceChildren();
  $("boardSourceDetails").textContent = "";
  $("boardChartCaption").textContent = "";
  renderBook();
  draw();
  selected(null);
  $("marketBoardStatus").textContent = "正在取得市場行情…";
  try {
    const result = await json("/api/market/board/chart?" + params, signal);
    if (version !== board.version) return;
    board.result = result;
    if (reset) {
      board.start = 0;
      board.count = 0;
    }
    $("boardChartTitle").textContent =
      `${board.product === "index" ? "加權指數" : board.product === "night" ? "台指期夜盤" : "台指期日盤"} · ${historical() ? (board.product === "index" ? "歷史收盤指數" : $("boardExpiry").value) : result.contract_month || "現貨指數"}`;
    $("marketBoardStatus").textContent = [
      historical()
        ? "圖表與下方數值依歷史區間；上方三張行情卡為最新取得快照。"
        : result.status === "closed"
          ? "本盤已收盤，顯示最近一盤行情。"
          : "公開行情快照；自動更新每15秒檢查。",
      ...(result.warnings || []),
      result.warning,
    ]
      .filter(Boolean)
      .join(" ");
    $("boardSourceDetails").textContent =
      `${result.source_label} · 官方盤別日期 ${result.source_date || "依圖表日期"} ${result.source_clock || ""} · 接收 ${result.received_at ? new Date(result.received_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }) : "依各月來源紀錄"}。${result.note || ""}`;
    renderBook();
    renderStatistics();
    draw();
  } catch (error) {
    if (signal.aborted) return;
    $("marketBoardStatus").textContent = error.message;
    $("boardChartCaption").textContent =
      "來源無法提供此區間，未使用其他盤別或合約代替。";
  }
}
async function refresh(auto = false) {
  $("refreshMarketBoard").disabled = true;
  try {
    const result = await json("/api/market/board", AbortSignal.timeout(30000));
    board.quotes = result.products;
    if (!$("marketChipsDate").dataset.userSelected)
      $("marketChipsDate").value =
        result.products.find((q) => q.session === "index")?.source_date ||
        $("marketChipsDate").value;
    contracts();
    cards();
    updateControls();
    await refreshChart(!auto);
    if (result.warnings?.length)
      $("marketBoardStatus").textContent += " " + result.warnings.join("；");
  } catch (error) {
    $("marketBoardStatus").textContent = error.message;
  } finally {
    $("refreshMarketBoard").disabled = false;
  }
}
export function marketBoardChanged() {
  if (active() && !board.quotes.length) refresh();
}
export function initMarketBoardController() {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  $("boardEnd").value = today;
  $("marketChipsDate").value = today;
  $("marketChipsDate").max = today;
  $("marketChipsDate").onchange = () =>
    ($("marketChipsDate").dataset.userSelected = "true");
  initMarketChips();
  document.querySelectorAll("[data-market-tab]").forEach(
    (button) =>
      (button.onclick = () => {
        board.tab = button.dataset.marketTab;
        $("marketBoardPanel").dataset.marketView = board.tab;
        document
          .querySelectorAll("[data-market-tab]")
          .forEach((b) =>
            b.setAttribute(
              "aria-pressed",
              String(b.dataset.marketTab === board.tab),
            ),
          );
        const chips = board.tab === "chips";
        $("boardPriceWorkspace").hidden = chips;
        $("marketChipsWorkspace").hidden = !chips;
        $("marketBoardCards").hidden = chips;
        if (chips) {
          loadMarketChips();
          return;
        }
        $("boardMode").value =
          board.tab === "technical" ? "history" : "intraday";
        updateControls();
        renderBook();
        refreshChart();
      }),
  );
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 90);
  $("boardStart").value = d.toISOString().slice(0, 10);
  $("refreshMarketBoard").onclick = () =>
    board.tab === "chips" ? loadMarketChips() : refresh();
  new ResizeObserver(() => draw()).observe($("boardChart"));
  $("boardContract").onchange = () => {
    cards();
    refreshChart();
  };
  $("boardMode").onchange = () => {
    updateControls();
    refreshChart();
  };
  $("boardRangeForm").onsubmit = (event) => {
    event.preventDefault();
    refreshChart();
  };
  $("boardExpiry").onchange = () => refreshChart();
  for (const id of [
    "boardResolution",
    "boardChartType",
    "boardMA5",
    "boardMA20",
  ])
    $(id).onchange = () => {
      board.count = 0;
      board.start = 0;
      draw();
    };
  $("boardResetChart").onclick = () => {
    board.start = 0;
    board.count = 0;
    draw();
  };
  $("boardMonitor").onchange = () => {
    if ($("boardMonitor").checked) refresh();
  };
  setInterval(() => {
    if (
      active() &&
      !document.hidden &&
      $("boardMonitor").checked &&
      !historical() &&
      board.result?.status !== "closed" &&
      !$("refreshMarketBoard").disabled
    )
      refresh(true);
  }, 15000);
}
