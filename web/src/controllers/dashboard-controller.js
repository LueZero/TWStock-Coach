import {
  state,
  json,
  isMinute,
  maPeriods,
  taipeiDay,
  shiftDay,
  loadFavorites,
} from "./../models/stock-model.js";
import {
  renderFavorites,
  $,
  updateRangeSelection,
  updatePeriodHelp,
  closeSuggestions,
  message,
  emptyQuote,
  renderBook,
  renderAnalysis,
  renderHistory,
  plot,
  renderQuote,
  updateRangeStatus,
  renderHistoricalSummary,
  historyResult,
  localTime,
  periodLabel,
  fmt,
  chartState,
  amount,
  maValue,
  renderMonitorStatus,
  clock,
} from "./../views/dashboard-view.js";
import { renderChips } from "./../views/research-view.js";
import { mediaChanged } from "./media-controller.js";

let searchTimer = null,
  searchVersion = 0,
  searchResults = [],
  historyRequest = 0;

function saveFavorites() {
  try {
    localStorage.setItem(
      "stock-coach-favorites",
      JSON.stringify(state.favorites),
    );
  } catch {}
  renderFavorites();
}

async function selectStock(stock) {
  searchVersion++;
  state.rangeRequest++;
  state.controller.abort();
  state.controller = new AbortController();
  state.generation++;
  state.stock = stock;
  state.mode = "live";
  $("endDate").value = taipeiDay();
  if ($("startDate").value > taipeiDay())
    $("startDate").value = shiftDay(taipeiDay(), -180);
  state.assistantOverlay = null;
  document.dispatchEvent(
    new CustomEvent("stock-coach:stock", { detail: { stock } }),
  );
  mediaChanged();
  if ($("dashboardGrid").dataset.view === "indices")
    document.querySelector('[data-app-page="stock"]').click();
  state.range = { start: $("startDate").value, end: $("endDate").value };
  updateRangeSelection();
  updatePeriodHelp();
  state.quote = null;
  state.rows = [];
  state.points = [];
  state.loading = false;
  state.selected = null;
  $("selectedBar").textContent = "點選 K 線可查看該期價格、技術指標與訊號。";
  state.viewport = { start: 0, count: null };
  state.quoteBusy = false;
  $("stockName").textContent = stock.name || stock.symbol;
  $("stockCode").textContent = stock.symbol;
  $("marketName").textContent =
    stock.market === "TWSE"
      ? "上市 · 臺灣證券交易所"
      : "上櫃 · 證券櫃檯買賣中心";
  $("industry").textContent = stock.industry || "";
  $("stockInput").value = "";
  closeSuggestions();
  message("");
  emptyQuote();
  renderFavorites();
  renderBook();
  renderAnalysis();
  renderHistory();
  plot();
  $("quoteStatus").textContent =
    state.mode === "live"
      ? "正在取得這檔股票的行情與五檔…"
      : "歷史模式：以所選區間最後一根 K 線顯示價格。";
  try {
    localStorage.setItem("stock-coach-last", JSON.stringify(stock));
  } catch {}
  const gen = state.generation;
  refreshQuote(gen, true);
  await loadHistory(gen);
}

async function findStocks(query) {
  const version = ++searchVersion;
  if (!query.trim()) {
    closeSuggestions();
    searchResults = [];
    return;
  }
  const loading = document.createElement("p");
  loading.textContent = "搜尋股票…";
  loading.style.padding = "0 15px";
  $("suggestions").replaceChildren(loading);
  $("suggestions").hidden = false;
  $("stockInput").setAttribute("aria-expanded", "true");
  try {
    const response = await fetch(
      "/api/search?q=" + encodeURIComponent(query.trim()),
    );
    if (!response.ok) throw Error();
    const items = await response.json();
    if (
      version !== searchVersion ||
      $("stockInput").value.trim() !== query.trim()
    )
      return;
    searchResults = items;
    $("suggestions").replaceChildren();
    items.forEach((stock) => {
      const button = document.createElement("button");
      button.type = "button";
      const code = document.createElement("strong");
      code.textContent = stock.symbol;
      const name = document.createElement("span");
      name.textContent = stock.name;
      const market = document.createElement("small");
      market.textContent = stock.market_label + " · " + stock.industry;
      button.append(code, name, market);
      button.onclick = () => selectStock(stock);
      $("suggestions").append(button);
    });
    if (!items.length) {
      const note = document.createElement("p");
      note.textContent = "找不到這個代號或名稱，請檢查輸入。";
      note.style.padding = "0 15px";
      $("suggestions").append(note);
    }
    $("suggestions").hidden = false;
    $("stockInput").setAttribute("aria-expanded", "true");
  } catch {
    if (version === searchVersion) {
      closeSuggestions();
      message("股票搜尋目前無法更新，仍可使用已有的自選股。");
    }
  }
}

async function refreshQuote(gen = state.generation, manual = false) {
  if (state.mode !== "live" || state.quoteBusy) return;
  if (!manual && (!$("autoRefresh").checked || !state.market?.monitor_allowed))
    return;
  state.quoteBusy = true;
  const { market, symbol } = state.stock;
  try {
    const q = await json(`/api/quote/${market}/${symbol}`);
    if (gen !== state.generation) return;
    state.quote = q;
    state.lastRefresh = Date.now();
    renderQuote();
    if (isMinute() && state.market?.monitor_allowed) await fetchHistory(gen);
  } catch (error) {
    if (error.name === "AbortError" || gen !== state.generation) return;
    if (state.quote) state.quote = { ...state.quote, state: "unavailable" };
    $("quoteStatus").textContent = state.quote
      ? `無法更新行情：${error.message}。畫面為上次快照，並非新報價。`
      : `無法取得行情：${error.message}`;
    $("quoteStatus").className = "source-status warning";
    $("bookBadge").textContent = "無法更新";
  } finally {
    if (gen === state.generation) state.quoteBusy = false;
  }
}

function dailyUrl() {
  const { market, symbol } = state.stock;
  const params = new URLSearchParams({
    resolution: state.resolution,
    price_basis: $("priceBasis").value,
    start: state.range.start,
    end: state.range.end,
    ma_periods: maPeriods.join(","),
  });
  return `/api/chart/${market}/${symbol}?${params}`;
}

async function fetchHistory(gen) {
  const request = ++historyRequest;
  const result = await json(dailyUrl());
  if (gen !== state.generation || request !== historyRequest) return;
  state.rows = result.data;
  updateRangeStatus();
  const selectedStamp = state.selected?.timestamp;
  state.selected =
    state.rows.find((row) => row.timestamp === selectedStamp) || null;
  if (!state.selected)
    $("selectedBar").textContent = "點選 K 線可查看該期價格、技術指標與訊號。";
  renderAnalysis();
  renderHistory();
  if (state.mode === "history") renderHistoricalSummary();
  plot();
}

function restartHistory() {
  state.range = { start: $("startDate").value, end: $("endDate").value };
  updateRangeSelection();
  state.generation++;
  state.controller.abort();
  state.controller = new AbortController();
  state.rows = [];
  state.points = [];
  state.selected = null;
  state.viewport = { start: 0, count: null };
  state.quoteBusy = false;
  $("selectedBar").textContent = "點選 K 線可查看該期價格、技術指標與訊號。";
  state.loading = false;
  renderAnalysis();
  renderHistory();
  if (state.mode === "history") renderHistoricalSummary();
  plot();
  const error = rangeError();
  updatePeriodHelp();
  if (error) {
    message(error);
    $("rangeStatus").textContent = error;
    $("historyStatus").textContent = error;
    return Promise.resolve();
  }
  message("");
  return loadHistory();
}

async function loadHistory(gen = state.generation) {
  const { start, end } = state.range;
  const invalid = rangeError();
  if (invalid) {
    message(invalid);
    $("rangeStatus").textContent = invalid;
    return;
  }
  state.loading = true;
  $("historyStatus").textContent = "查詢歷史資料…";
  try {
    await fetchHistory(gen);
    if (gen !== state.generation) return;
    let historicalEnd = end;
    if (end >= taipeiDay()) {
      const market = await json("/api/market/status");
      if (gen !== state.generation) return;
      state.market = market;
      renderMonitorStatus();
      historicalEnd = isMinute()
        ? shiftDay(taipeiDay(), -1)
        : market.daily_source_end || shiftDay(taipeiDay(), -1);
    }
    if (start > historicalEnd) {
      state.loading = false;
      $("historyStatus").textContent = isMinute()
        ? "今日分鐘 K 需盤中分鐘行情來源；目前僅讀取已接入資料。"
        : "今日完成日 K 尚未由盤後來源提供；可查看最近完成交易日，或勾選即時監控查看最新行情。";
      return;
    }
    const job = await json("/api/history/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        market: state.stock.market,
        symbol: state.stock.symbol,
        start,
        end: historicalEnd,
        price_basis: $("priceBasis").value,
        timeframe: isMinute() ? "1m" : "1d",
        warmup_days: Math.min(
          8000,
          Math.max(
            420,
            Math.max(...maPeriods) *
              ({ "1d": 2, "1w": 8, "1mo": 32 }[state.resolution] || 2),
          ),
        ),
      }),
    });
    if (gen !== state.generation) return;
    if (
      ["success", "quality_warning", "no_data", "failed"].includes(job.status)
    ) {
      await fetchHistory(gen);
      if (gen !== state.generation) return;
      $("historyStatus").textContent = historyResult(job);
      state.loading = false;
      return;
    }
    $("historyStatus").textContent =
      `正在從來源載入 ${start} 至 ${historicalEnd}，目前畫面 ${state.rows.length} 根 K 線…`;
    pollJob(job.job_id, gen, 0);
  } catch (error) {
    if (error.name === "AbortError" || gen !== state.generation) return;
    state.loading = false;
    $("historyStatus").textContent = error.message;
    $("rangeStatus").textContent = `查詢失敗：${error.message}`;
  }
}

function pollJob(id, gen, attempt) {
  setTimeout(async () => {
    if (gen !== state.generation) return;
    try {
      const job = await json("/api/jobs/" + id);
      if (gen !== state.generation) return;
      if (
        ["success", "quality_warning", "no_data", "failed"].includes(job.status)
      ) {
        state.loading = false;
        await fetchHistory(gen);
        if (gen !== state.generation) return;
        $("historyStatus").textContent = historyResult(job);
        return;
      }
      $("historyStatus").textContent =
        `歷史載入中${job.details?.loaded_through ? "，已查至 " + job.details.loaded_through : ""}…`;
      if (attempt < 120) pollJob(id, gen, attempt + 1);
      else {
        $("historyStatus").textContent = "資料仍在載入，可稍後按更新重新查詢。";
        state.loading = false;
      }
    } catch (error) {
      if (error.name !== "AbortError" && gen === state.generation) {
        $("historyStatus").textContent = "資料工作狀態暫時無法取得";
        state.loading = false;
      }
    }
  }, 2000);
}

function selectBar(row) {
  state.selected = row;
  document.dispatchEvent(
    new CustomEvent("stock-coach:bar", { detail: { row } }),
  );
  $("selectedBar").textContent =
    `${localTime(row.timestamp)} · ${periodLabel()} K · 收盤 ${fmt(row.close)} · ${row.is_final ? "已完成" : "未完成"} · ${row.technical_state?.label || ""} · ${row.signals?.join("、") || "當期無新交叉／突破／跌破訊號"}`;
  renderAnalysis();
}

function moveChart(delta) {
  state.viewport.start += delta;
  plot();
}

function zoomChart(factor, anchor = 0.5) {
  const total =
    state.chart === "intraday" ? state.points.length : state.rows.length;
  if (!total) return;
  const old = state.viewport.count || total,
    next = Math.max(
      Math.min(5, total),
      Math.min(total, Math.round(old * factor)),
    );
  state.viewport.start += Math.round((old - next) * anchor);
  state.viewport.count = next;
  plot();
}

let drag = null;

function setChart(kind) {
  state.chart = kind;
  plot();
}

function setMode(mode) {
  state.mode = mode;
  $("autoRefresh").checked = mode === "live";
  if (mode === "history") {
    renderHistoricalSummary();
    renderBook();
  } else {
    renderQuote();
    refreshQuote(state.generation, true);
  }
  renderAnalysis();
}

async function updateDates(days) {
  const end = $("endDate").value || shiftDay(taipeiDay(), -1);
  const version = ++state.rangeRequest;
  message("正在依交易日曆計算區間…");
  try {
    const response = await fetch(
      `/api/market/range?end=${encodeURIComponent(end)}&sessions=${days + 1}`,
    );
    const range = await response.json();
    if (version !== state.rangeRequest) return;
    if (!response.ok)
      throw Error(range.detail || "交易日曆無法確認，請改用自訂日期。");
    $("startDate").value = range.start;
    $("endDate").value = range.end;
    state.presetRange = {
      start: range.start,
      end: range.end,
      sessions: range.sessions,
    };
  } catch (error) {
    if (version === state.rangeRequest) message(error.message);
    return;
  }
  return applyRange(days);
}

function rangeError() {
  const { start, end } = state.range;
  if (!start || !end || start > end) return "起始日期必須早於或等於截止日期。";
  if (end > taipeiDay()) return "截止日期不能晚於今日。";
  if (start < (isMinute() ? "2019-01-01" : "1994-10-01"))
    return isMinute()
      ? "分鐘歷史來源從 2019 年起提供。"
      : "日 K 歷史來源從 1994 年 10 月起提供。";
  const days = (new Date(end) - new Date(start)) / 86400000;
  if (isMinute() && days > 30)
    return "分鐘／小時 K 一次最多 31 個日曆日。日期已保留，請選單日、近 7 日或縮小範圍。";
  if (days > 3653) return "日期範圍最多十年，請縮小查詢區間。";
  return "";
}

function applyRange(preset = null) {
  state.rangeRequest++;
  state.rangePreset = typeof preset === "number" ? preset : null;
  $("autoRefresh").checked = false;
  state.mode = "history";
  state.monitoringActive = false;
  renderBook();
  renderMonitorStatus();
  return restartHistory();
}

async function checkMarket(force = false) {
  if (!force && Date.now() - state.marketChecked < 60000) return;
  state.marketChecked = Date.now();
  const previousDailyEnd = state.market?.daily_source_end;
  try {
    const response = await fetch("/api/market/status");
    if (!response.ok) throw Error();
    state.market = await response.json();
  } catch {
    state.market = {
      monitor_allowed: false,
      reason: "交易日曆無法確認，暫停自動監控",
    };
  }
  const active = $("autoRefresh").checked && state.market.monitor_allowed;
  if (
    previousDailyEnd &&
    previousDailyEnd !== state.market.daily_source_end &&
    state.mode === "live" &&
    !isMinute() &&
    $("endDate").value === taipeiDay()
  )
    restartHistory();
  if (active && !state.monitoringActive) {
    const end = taipeiDay();
    $("endDate").max = taipeiDay();
    if ($("endDate").value !== end) {
      const days = Math.max(
        0,
        Math.round(
          (new Date($("endDate").value) - new Date($("startDate").value)) /
            86400000,
        ),
      );
      $("endDate").value = end;
      $("startDate").value = shiftDay(
        end,
        -(isMinute() ? Math.min(30, days) : days),
      );
      state.mode = "live";
      restartHistory();
    }
    state.lastRefresh = 0;
    refreshQuote();
  }
  state.monitoringActive = active;
  renderMonitorStatus();
}

let initial = state.stock;

export function initDashboardController() {
  $("stockInput").oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => findStocks($("stockInput").value), 300);
  };
  $("searchForm").onsubmit = async (event) => {
    event.preventDefault();
    const q = $("stockInput").value.trim();
    if (!q) return;
    clearTimeout(searchTimer);
    const version = ++searchVersion;
    try {
      const response = await fetch("/api/search?q=" + encodeURIComponent(q));
      if (!response.ok) throw Error();
      const items = await response.json();
      if (version !== searchVersion) return;
      const chosen =
        items.find((s) => s.symbol === q) ||
        items.find((s) => s.name === q) ||
        items[0];
      if (!chosen) {
        message("找不到這檔股票，請輸入有效的上市／上櫃股票代號或名稱。");
        return;
      }
      selectStock(chosen);
    } catch {
      if (version === searchVersion)
        message("股票搜尋暫時無法使用，請稍後再試。");
    }
  };
  $("stockInput").onkeydown = (event) => {
    if (event.key === "Escape") closeSuggestions();
  };
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-wrap")) closeSuggestions();
  });
  $("favoriteToggle").onclick = () => {
    const s = state.stock,
      index = state.favorites.findIndex(
        (i) => i.market === s.market && i.symbol === s.symbol,
      );
    if (index >= 0) state.favorites.splice(index, 1);
    else if (state.favorites.length < 30) state.favorites.push({ ...s });
    saveFavorites();
  };
  $("chart").onpointerdown = (event) => {
    if (!chartState) return;
    drag = {
      x: event.clientX,
      start: state.viewport.start,
      moved: false,
      markerTimestamp: event.target.closest?.("[data-bar-timestamp]")?.dataset
        .barTimestamp,
    };
    $("chart").setPointerCapture?.(event.pointerId);
  };
  $("chart").onpointerup = (event) => {
    if (!drag) return;
    if (!drag.moved && chartState && !chartState.intraday) {
      const rect = chartState.svg.getBoundingClientRect(),
        px = ((event.clientX - rect.left) / rect.width) * chartState.chartWidth;
      let closest = 0;
      for (let i = 1; i < chartState.rows.length; i++)
        if (
          Math.abs(chartState.x(i) - px) < Math.abs(chartState.x(closest) - px)
        )
          closest = i;
      const marked = chartState.rows.findIndex(
        (r) => r.timestamp === drag.markerTimestamp,
      );
      selectBar(chartState.rows[marked >= 0 ? marked : closest]);
      if (marked >= 0) $("selectedSignalDetails").open = true;
    }
    drag = null;
  };
  $("chart").onpointercancel = () => {
    drag = null;
  };
  $("chart").onwheel = (event) => {
    event.preventDefault();
    const rect = $("chart").getBoundingClientRect();
    zoomChart(
      event.deltaY > 0 ? 1.25 : 0.8,
      Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    );
  };
  $("chart").onpointermove = (event) => {
    if (!chartState) return;
    if (drag) {
      const dx = event.clientX - drag.x;
      if (Math.abs(dx) > 4) drag.moved = true;
      if (drag.moved) {
        state.viewport.start =
          drag.start -
          Math.round(
            (dx / (chartState.right - chartState.left)) *
              chartState.rows.length,
          );
        plot();
        return;
      }
    }
    const { rows, x, svg, intraday } = chartState;
    const rect = svg.getBoundingClientRect(),
      px = ((event.clientX - rect.left) / rect.width) * chartState.chartWidth;
    let closest = 0;
    for (let i = 1; i < rows.length; i++)
      if (Math.abs(x(i) - px) < Math.abs(x(closest) - px)) closest = i;
    const marked = rows.findIndex(
      (r) =>
        r.timestamp ===
        event.target.closest?.("[data-bar-timestamp]")?.dataset.barTimestamp,
    );
    if (marked >= 0) closest = marked;
    const r = rows[closest],
      line = $("crosshair");
    line.setAttribute("x1", x(closest));
    line.setAttribute("x2", x(closest));
    line.setAttribute("visibility", "visible");
    $("chartTooltip").textContent = intraday
      ? `${localTime(r.source_time)}\n最新成交 ${fmt(r.last_price)}\n累計量 ${amount(r.volume_shares)} ${$("volumeUnit").value === "lots" ? "張" : "股"}`
      : `${isMinute() ? localTime(r.timestamp) : r.trade_date} · ${r.is_final ? "完成" : "未完成"} ${periodLabel()} K\n開盤 ${fmt(r.open)}　最高 ${fmt(r.high)}\n最低 ${fmt(r.low)}　收盤 ${fmt(r.close)}\n成交量 ${amount(r.volume)} ${$("volumeUnit").value === "lots" ? "張" : "股"}\n${[...state.shownMAs].map((p) => `MA${p} ${fmt(maValue(r, p))}`).join("　")}\n${r.technical_state?.label || ""} · ${r.signals?.join("、") || "當期無新技術事件"}`;
    $("chartTooltip").hidden = false;
  };
  $("chart").onpointerleave = () => {
    $("chartTooltip").hidden = true;
    $("crosshair")?.setAttribute("visibility", "hidden");
  };
  globalThis.addEventListener?.("resize", () => plot());
  $("chartSettings").addEventListener("shown.bs.collapse", () => plot());
  $("chartSettings").addEventListener("hidden.bs.collapse", () => plot());
  $("resolution").onchange = () => {
    state.resolution = $("resolution").value;
    state.chart = "daily";
    $("priceBasis").disabled = isMinute();
    if (isMinute()) $("priceBasis").value = "raw";
    applyRange();
  };
  document
    .querySelectorAll("[data-days]")
    .forEach((b) => (b.onclick = () => updateDates(Number(b.dataset.days))));
  $("startDate").onchange = applyRange;
  $("endDate").onchange = applyRange;
  $("applyDates").onclick = applyRange;
  $("priceBasis").onchange = () => restartHistory();
  $("volumeUnit").onchange = () => {
    if (typeof renderChips === "function") renderChips();
    renderQuote();
    renderBook();
    renderHistory();
    plot();
  };
  $("refreshButton").onclick = async () => {
    await restartHistory();
    refreshQuote(state.generation, true);
  };
  $("autoRefresh").onchange = () => {
    if (!$("autoRefresh").checked) {
      state.monitoringActive = false;
      renderMonitorStatus();
      return;
    }
    state.mode = "live";
    $("endDate").value = taipeiDay();
    if (isMinute()) $("startDate").value = shiftDay($("endDate").value, -7);
    renderQuote();
    renderBook();
    restartHistory();
    checkMarket(true);
  };
  $("clearMAs").onclick = () => {
    state.shownMAs.clear();
    plot();
  };
  $("showSignals").onchange = () => plot();
  $("signalCategory").onchange = () => plot();
  $("showBollinger").onchange = () => plot();
  $("subIndicator").onchange = () => plot();
  $("panLeft").onclick = () =>
    moveChart(
      -Math.max(1, Math.round((state.viewport.count || state.rows.length) / 4)),
    );
  $("panRight").onclick = () =>
    moveChart(
      Math.max(1, Math.round((state.viewport.count || state.rows.length) / 4)),
    );
  $("zoomIn").onclick = () => zoomChart(0.7);
  $("zoomOut").onclick = () => zoomChart(1.4);
  $("resetChart").onclick = () => {
    state.viewport = { start: 0, count: null };
    plot();
  };
  setInterval(() => {
    checkMarket();
    renderMonitorStatus();
    if (
      $("autoRefresh").checked &&
      state.market?.monitor_allowed &&
      Date.now() - state.lastRefresh >=
        Number($("refreshInterval").value) * 1000
    ) {
      state.lastRefresh = Date.now();
      refreshQuote();
    }
  }, 1000);
  setInterval(clock, 1000);
  clock();
  checkMarket();
  renderMonitorStatus();
  $("endDate").value = taipeiDay();
  $("endDate").max = taipeiDay();
  $("startDate").value = shiftDay($("endDate").value, -180);
  $("resolution").value = "1d";
  loadFavorites();
  try {
    const previous = JSON.parse(
      localStorage.getItem("stock-coach-last") || "null",
    );
    if (
      previous &&
      ["TWSE", "TPEX"].includes(previous.market) &&
      /^[A-Za-z0-9]{2,16}$/.test(previous.symbol)
    )
      initial = previous;
  } catch {}
  selectStock(initial);
}

export {
  searchTimer,
  searchVersion,
  searchResults,
  saveFavorites,
  selectStock,
  findStocks,
  refreshQuote,
  dailyUrl,
  fetchHistory,
  restartHistory,
  loadHistory,
  pollJob,
  selectBar,
  moveChart,
  zoomChart,
  drag,
  setChart,
  setMode,
  updateDates,
  rangeError,
  applyRange,
  checkMarket,
  initial,
};
