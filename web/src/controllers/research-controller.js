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
  renderBranches,
} from "./../views/research-view.js";
import { postOptions, loadFinancials } from "./analysis-controller.js";

let equityVersion = 0,
  equityStock = "",
  equitySignature = "";

const equityLoads = new Set();

function researchSignature() {
  return JSON.stringify([
    stockKey(),
    state.range,
    $("financialMode").value,
    state.selected?.timestamp,
  ]);
}

function researchChanged() {
  if (equityStock !== stockKey()) {
    equityStock = stockKey();
    equitySignature = "";
    equityVersion++;
    state.equityData = null;
    if (state.insight) bootstrap.Modal.getInstance($("insightModal"))?.hide();
    state.insight = null;
    renderBasic();
    renderChips();
  }
  const view = $("dashboardGrid").dataset.view;
  if (!["basic", "chips"].includes(view)) return;
  const signature = researchSignature();
  if (signature === equitySignature) return;
  equitySignature = signature;
  const loadKey = stockKey() + ":" + state.range.end;
  const load =
    $("financialMode").value !== "historical" && !equityLoads.has(loadKey);
  if (load) equityLoads.add(loadKey);
  refreshEquity(load);
}

async function refreshEquity(load = false) {
  const version = ++equityVersion,
    key = stockKey(),
    signature = researchSignature();
  const historical = $("financialMode").value === "historical",
    bar = analysisBar();
  state.equityData = null;
  $("basicStatus").textContent = "正在讀取公司基本資料…";
  renderBasic();
  renderChips();
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
    const data = await analysisJson(
      `/api/equity/${state.stock.market}/${state.stock.symbol}?${params}`,
    );
    if (!current()) return;
    state.equityData = data;
    renderBasic();
    renderChips();
    $("basicStatus").textContent =
      `${state.stock.name} ${state.stock.symbol} · 公司基本資料與機構研究。`;
    $("chipStatus").textContent =
      `${state.stock.name} ${state.stock.symbol} · ${data.start} 至 ${data.end} · ${historical ? "所選 K 線當時可得" : "最新取得修訂"}。${data.note}`;
    if (load && !historical) {
      const job = await analysisJson(
        "/api/equity/load",
        postOptions({
          market: state.stock.market,
          symbol: state.stock.symbol,
          end: state.range.end,
        }),
      );
      if (!current()) return;
      if (["queued", "running"].includes(job.status))
        pollEquity(job.job_id, version, key, signature, 0);
      else {
        const result = await analysisJson("/api/jobs/" + job.job_id);
        if (!current()) return;
        await refreshEquity(false);
        if (key === stockKey() && signature === researchSignature())
          renderEquityLoadStatus(result.details?.datasets || {});
      }
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
  setTimeout(async () => {
    if (
      version !== equityVersion ||
      key !== stockKey() ||
      signature !== researchSignature()
    )
      return;
    try {
      const job = await analysisJson("/api/jobs/" + id);
      if (
        version !== equityVersion ||
        key !== stockKey() ||
        signature !== researchSignature()
      )
        return;
      if (["queued", "running"].includes(job.status) && attempt < 180) {
        $("chipStatus").textContent =
          `籌碼來源載入中：完成 ${Object.keys(job.details?.datasets || {}).length} 個資料集；付費項目不以免費數字替代。`;
        pollEquity(id, version, key, signature, attempt + 1);
      } else {
        await refreshEquity(false);
        if (key === stockKey() && signature === researchSignature())
          renderEquityLoadStatus(job.details?.datasets || {});
      }
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
    loadFinancials();
    refreshEquity(true);
  };
  $("refreshChips").onclick = () => refreshEquity(true);
  $("branchSort").onchange = renderBranches;
  $("branchSearch").oninput = renderBranches;
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
