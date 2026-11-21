import * as bootstrap from "bootstrap/dist/js/bootstrap.esm.js";
import {
  stockKey,
  state,
  analysisBar,
  analysisJson,
} from "./../models/stock-model.js";
import { $ } from "./../views/dashboard-view.js";
import {
  renderBasic,
  renderChips,
  periodDate,
  renderInsight,
} from "./../views/research-view.js";
import { initChipWorkspace } from "../views/chip-workspace-view.js";

let equityVersion = 0,
  equityStock = "",
  equitySignature = "";

const equityLoads = new Set();
const equityViews = new Map();
let equityTimer;

function renderActiveResearch() {
  if ($("dashboardGrid").dataset.view === "basic") renderBasic();
  if ($("dashboardGrid").dataset.view === "chips") renderChips();
}

function researchSignature() {
  return JSON.stringify([
    stockKey(),
    $("dashboardGrid").dataset.view,
    state.range,
    $("financialMode").value,
    state.selected?.timestamp,
  ]);
}

function researchChanged() {
  if (equityStock !== stockKey()) {
    equityStock = stockKey();
    equitySignature = "";
    equityViews.clear();
    clearTimeout(equityTimer);
    equityVersion++;
    state.equityData = null;
    if (state.insight) bootstrap.Modal.getInstance($("insightModal"))?.hide();
    state.insight = null;
    renderBasic();
    renderChips();
  }
  const view = $("dashboardGrid").dataset.view;
  if (!["basic", "chips"].includes(view)) {
    clearTimeout(equityTimer);
    equityVersion++;
    equitySignature = "";
    return;
  }
  const signature = researchSignature();
  if (signature === equitySignature) return;
  equitySignature = signature;
  const loadKey = stockKey() + ":" + state.range.end;
  const load =
    $("financialMode").value !== "historical" && !equityLoads.has(loadKey);
  if (load) equityLoads.add(loadKey);
  const cached = equityViews.get(signature);
  if (cached) {
    state.equityData = cached.response.data;
    renderActiveResearch();
    if (Date.now() - cached.at < 30000 && cached.response.state !== "updating")
      return;
  }
  refreshEquity(load);
}

async function refreshEquity(load = false, attempt = 0) {
  const version = ++equityVersion,
    key = stockKey(),
    signature = researchSignature();
  const historical = $("financialMode").value === "historical",
    bar = analysisBar();
  clearTimeout(equityTimer);
  if (attempt === 0) {
    state.equityData = equityViews.get(signature)?.response.data || null;
    $("basicStatus").textContent = "正在讀取公司基本資料…";
    renderActiveResearch();
  }
  const params = new URLSearchParams({
    start: state.range.start,
    end: state.range.end,
  });
  if (historical && !bar) {
    state.equityData = null;
    renderBasic();
    renderChips();
    $("chipStatus").textContent = "歷史視角尚未選到完成 K 線。";
    return;
  }
  if (historical)
    params.set(
      "as_of",
      new Date(
        Math.min(Date.now(), new Date(bar.end_time || bar.timestamp).getTime()),
      ).toISOString(),
    );
  $("chipStatus").textContent = "正在讀取來源修訂與所選區間…";
  const current = () =>
    version === equityVersion &&
    key === stockKey() &&
    signature === researchSignature();
  try {
    const response = await analysisJson(
      `/api/stock-data/${state.stock.market}/${state.stock.symbol}?section=${$("dashboardGrid").dataset.view === "basic" ? "basic" : "equity"}&${params}`,
    );
    const data = response.data;
    if (!current()) return;
    equityViews.set(signature, { response, at: Date.now() });
    if (equityViews.size > 16)
      equityViews.delete(equityViews.keys().next().value);
    state.equityData = data;
    renderActiveResearch();
    $("basicStatus").textContent =
      `${state.stock.name} ${state.stock.symbol} · ${data.instrument_type === "etf" ? "官方基金基本資料" : "公司基本資料與機構研究"}。`;
    $("chipStatus").textContent =
      `${state.stock.name} ${state.stock.symbol} · ${data.start} 至 ${data.end} · ${historical ? "不提供歷史當時可得版本" : "來源 API／記憶體快取，無 DB"} · 盤後資料，各子頁更新頻率不同。`;
    if (response.state === "updating" && attempt < 180)
      pollEquity(null, version, key, signature, attempt);
    else if (!historical) {
      renderEquityLoadStatus(response.update.details?.datasets || {});
      if (response.update.message)
        $("chipStatus").textContent += " " + response.update.message;
    }
  } catch (error) {
    if (current()) {
      $("basicStatus").textContent =
        "公司資料暫時無法取得；先顯示股票目錄資料。";
      $("chipStatus").textContent = error.message;
    }
  }
}

function renderEquityLoadStatus(datasets) {
  const missing = Object.values(datasets).filter(
    (s) => !["success"].includes(s.status),
  );
  if (missing.length)
    $("chipStatus").textContent +=
      ` ${missing.length} 項來源尚無資料或需設定；詳細原因列在來源區。`;
  [$("chipCoverage")].forEach((container) => {
    const details = document.createElement("p");
    details.className = "source-load-details";
    details.textContent = Object.entries(datasets)
      .filter(([, s]) => s.message)
      .map(([key, s]) => key + "：" + s.message)
      .join("；");
    container.append(details);
  });
}

function pollEquity(id, version, key, signature, attempt) {
  equityTimer = setTimeout(async () => {
    if (
      version !== equityVersion ||
      key !== stockKey() ||
      signature !== researchSignature()
    )
      return;
    try {
      await refreshEquity(true, attempt + 1);
    } catch (error) {
      if (version === equityVersion)
        $("chipStatus").textContent = error.message;
    }
  }, 2000);
}

function openInsight(insight) {
  if (insight.stock !== stockKey()) return;
  state.insight = {
    ...insight,
    points: insight.points
      .slice()
      .sort((a, b) => a.period.localeCompare(b.period)),
  };
  const points = state.insight.points;
  $("insightStart").value = points.length
    ? periodDate(points[0].period)
    : state.range.start;
  $("insightEnd").value = points.length
    ? periodDate(points.at(-1).period)
    : state.range.end;
  $("insightChartType").value = "line";
  bootstrap.Modal.getOrCreateInstance($("insightModal")).show();
}

export function initResearchController() {
  $("insightModal").addEventListener("shown.bs.modal", renderInsight);
  $("insightForm").onsubmit = (event) => {
    event.preventDefault();
    renderInsight();
  };
  $("insightChartType").onchange = renderInsight;
  document.querySelectorAll("[data-insight-years]").forEach(
    (button) =>
      (button.onclick = () => {
        if (!state.insight) return;
        const points = state.insight.points,
          years = Number(button.dataset.insightYears);
        if (!points.length) {
          renderInsight();
          return;
        }
        const end = periodDate(points.at(-1).period);
        $("insightEnd").value = end;
        const cursor = new Date(end + "T12:00:00Z");
        cursor.setUTCFullYear(cursor.getUTCFullYear() - years);
        $("insightStart").value = years
          ? cursor.toISOString().slice(0, 10)
          : periodDate(points[0].period);
        renderInsight();
      }),
  );
  $("refreshBasic").onclick = () => {
    refreshEquity(true);
  };
  $("refreshChips").onclick = () => refreshEquity(true);
  initChipWorkspace();
  [$("basicViewMode"), $("chipViewMode")].forEach(
    (select) =>
      (select.onchange = () => {
        $("financialMode").value = select.value;
        $("financialMode").onchange();
      }),
  );
  globalThis.addEventListener("resize", () => {
    if ($("insightModal").classList.contains("show")) renderInsight();
  });
  renderBasic();
  renderChips();
  researchChanged();
}

export {
  equityVersion,
  equityStock,
  equitySignature,
  equityLoads,
  researchSignature,
  researchChanged,
  refreshEquity,
  renderEquityLoadStatus,
  pollEquity,
  openInsight,
};
