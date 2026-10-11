import * as bootstrap from "bootstrap/dist/js/bootstrap.esm.js";
import {
  $,
  renderFinancialDetails,
  renderSectionContext,
  renderBacktestResult,
  plot,
} from "./../views/dashboard-view.js";
import {
  state,
  stockKey,
  analysisBar,
  analysisJson,
} from "./../models/stock-model.js";
import { renderFinancialResearch } from "./../views/financial-view.js";
import { researchChanged } from "./research-controller.js";
import { utilitiesChanged } from "./utility-controller.js";
import { renderBasic } from "./../views/research-view.js";
import { marketBoardChanged } from "./market-board-controller.js";
import { mediaChanged } from "./media-controller.js";

let financeStock = "",
  financeVersion = 0;

let simulationSignature = "",
  backtestVersion = 0;

function numeric(id, fallback = null) {
  const value = $(id).value.trim();
  return value === "" ? fallback : Number(value);
}

function analysisRequest() {
  return {
    market: state.stock.market,
    symbol: state.stock.symbol,
    start: state.range.start,
    end: state.range.end,
    resolution: state.resolution,
    price_basis: $("priceBasis").value,
    selected_timestamp: state.selected?.timestamp || null,
    fee_bps: numeric("feeBps", 10),
    slippage_bps: numeric("slippageBps", 5),
    sell_tax_bps: numeric("sellTaxBps", 0),
  };
}

function postOptions(body) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function clearBacktest() {
  backtestVersion++;
  $("backtestMetrics").replaceChildren();
  $("backtestTrades").replaceChildren();
  $("backtestNotes").textContent = "";
  $("backtestStatus").textContent = "區間或資料已變動，請重新執行回放。";
}

function analysisChanged() {
  mediaChanged();
  const key = stockKey();
  if (financeStock !== key) {
    financeStock = key;
    state.financialData = null;
    if (typeof renderFinancialResearch === "function")
      renderFinancialResearch(null);
    $("financialSummary").textContent = "正在取得這檔股票的財務資料…";
    $("financialMetrics").replaceChildren();
    $("financialCoverage").textContent = "";
    $("revenueRows").replaceChildren();
    $("financialPeriods").textContent = "";
    $("financialRaw").removeAttribute("href");
    $("financialStatus").textContent = "正在取得這檔股票的財務資料…";
    loadFinancials();
  }
  const signature = JSON.stringify([
    key,
    state.range,
    state.resolution,
    $("priceBasis").value,
    state.rows.map((r) => [r.timestamp, r.source_revisions]),
  ]);
  if (simulationSignature !== signature) {
    simulationSignature = signature;
    clearBacktest();
  }
  if ($("financialMode").value === "historical") refreshFinancialView();
  if (typeof researchChanged === "function") researchChanged();
  if (typeof utilitiesChanged === "function") utilitiesChanged();
}

async function refreshFinancialView() {
  const version = ++financeVersion,
    key = stockKey(),
    bar = analysisBar();
  const historical = $("financialMode").value === "historical";
  const cutoff = bar
    ? new Date(
        Math.min(Date.now(), new Date(bar.end_time || bar.timestamp).getTime()),
      ).toISOString()
    : null;
  if (historical && !cutoff) {
    state.financialData = null;
    if (typeof renderBasic === "function") renderBasic();
    $("financialMetrics").replaceChildren();
    $("revenueRows").replaceChildren();
    $("financialCoverage").textContent = "";
    $("financialPeriods").textContent = "";
    $("financialRaw").removeAttribute("href");
    $("financialStatus").textContent = "尚未選到可分析 K 線";
    return;
  }
  const params = historical ? "?as_of=" + encodeURIComponent(cutoff) : "";
  try {
    const data = await analysisJson(
      `/api/fundamentals/${state.stock.market}/${state.stock.symbol}${params}`,
    );
    if (version !== financeVersion || key !== stockKey()) return;
    state.financialData = data;
    renderFinancialDetails(data, historical, params);
    if (typeof renderBasic === "function") renderBasic();
  } catch (error) {
    if (version === financeVersion && key === stockKey())
      $("financialStatus").textContent = error.message;
  }
}

async function loadFinancials() {
  const key = stockKey();
  try {
    await refreshFinancialView();
    if (key !== stockKey()) return;
    const job = await analysisJson(
      "/api/fundamentals/load",
      postOptions({ market: state.stock.market, symbol: state.stock.symbol }),
    );
    if (key !== stockKey()) return;
    if (["queued", "running"].includes(job.status))
      pollFinancials(job.job_id, key, 0);
    else {
      await refreshFinancialView();
    }
  } catch (error) {
    if (key === stockKey()) $("financialStatus").textContent = error.message;
  }
}

function pollFinancials(id, key, attempt) {
  setTimeout(async () => {
    if (key !== stockKey()) return;
    try {
      const job = await analysisJson("/api/jobs/" + id);
      if (key !== stockKey()) return;
      if (["queued", "running"].includes(job.status) && attempt < 180) {
        $("financialStatus").textContent =
          `財務資料載入中，完成 ${Object.keys(job.details?.datasets || {}).length}／6 個來源資料集…`;
        pollFinancials(id, key, attempt + 1);
      } else {
        await refreshFinancialView();
        if (key !== stockKey()) return;
        const failed = Object.values(job.details?.datasets || {}).filter(
          (s) => s.status === "failed",
        ).length;
        if (failed)
          $("financialStatus").textContent +=
            ` ${failed} 個資料集載入失敗，請檢查來源權限、配額或網路；未用假資料補齊。`;
      }
    } catch (error) {
      if (key === stockKey()) $("financialStatus").textContent = error.message;
    }
  }, 2000);
}

function selectSection(view, scroll = true) {
  if (
    ![
      "overview",
      "assistant",
      "indices",
      "technical",
      "basic",
      "financial",
      "chips",
      "calculator",
      "peers",
      "news",
      "backtest",
    ].includes(view)
  )
    return;
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.hidden = !panel.dataset.viewPanel.split(" ").includes(view);
  });
  document.querySelectorAll("[data-section]").forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.section === view);
  });
  const main = document.querySelector(".main-column"),
    side = document.querySelector(".side-column");
  main.hidden = false;
  side.hidden = view !== "overview";
  $("queryControls").hidden = [
    "calculator",
    "peers",
    "indices",
    "news",
    "assistant",
  ].includes(view);
  const page =
    view === "assistant"
      ? "assistant"
      : view === "indices"
        ? "market"
        : view === "calculator"
          ? "calculator"
          : "stock";
  $("sectionNav").hidden = page !== "stock";
  document
    .querySelectorAll("[data-app-page]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.appPage === page),
      ),
    );
  $("dashboardGrid").dataset.view = view;
  document.body.dataset.page = page;
  document.querySelector(".stock-header").hidden = page !== "stock";
  document.querySelector(".quote-strip").hidden = page !== "stock";
  renderSectionContext();
  $("dashboardGrid").classList.toggle(
    "single-column",
    main.hidden || side.hidden,
  );
  if (view === "overview") plot();
  if (view === "indices") marketBoardChanged();
  mediaChanged();
  document.dispatchEvent(
    new CustomEvent("stock-coach:section", { detail: { view } }),
  );
  if (
    ["basic", "chips"].includes(view) &&
    typeof researchChanged === "function"
  )
    researchChanged();
  if (typeof utilitiesChanged === "function") utilitiesChanged();
  if (scroll)
    (view === "indices"
      ? $("marketBoardPanel")
      : view === "calculator"
        ? $("calculatorPanel")
        : $("sectionNav")
    ).scrollIntoView({ block: "nearest", behavior: "smooth" });
}

export function initAnalysisController() {
  $("financialMode").onchange = () => {
    $("basicViewMode").value = $("chipViewMode").value =
      $("financialMode").value;
    bootstrap.Modal.getInstance($("insightModal"))?.hide();
    state.insight = null;
    state.financialData = null;
    $("financialMetrics").replaceChildren();
    $("financialSummary").textContent = "正在切換資料視角…";
    if (typeof renderBasic === "function") renderBasic();
    refreshFinancialView();
    if (typeof researchChanged === "function") researchChanged();
  };
  $("refreshFinancials").onclick = loadFinancials;
  $("runBacktest").onclick = async () => {
    clearBacktest();
    const gen = state.generation,
      key = stockKey(),
      version = ++backtestVersion;
    const request = analysisRequest();
    $("backtestStatus").textContent = "策略回放計算中…";
    try {
      const data = await analysisJson(
        "/api/strategy/backtest",
        postOptions(request),
      );
      if (
        gen !== state.generation ||
        key !== stockKey() ||
        version !== backtestVersion
      )
        return;
      renderBacktestResult(data);
    } catch (error) {
      if (
        gen === state.generation &&
        key === stockKey() &&
        version === backtestVersion
      )
        $("backtestStatus").textContent = error.message;
    }
  };
  ["feeBps", "slippageBps", "sellTaxBps"].forEach(
    (id) => ($(id).onchange = clearBacktest),
  );
  document
    .querySelectorAll("[data-section]")
    .forEach(
      (button) =>
        (button.onclick = () => selectSection(button.dataset.section)),
    );
  selectSection("overview", false);
  document.querySelectorAll("[data-app-page]").forEach((button) => {
    button.onclick = () =>
      selectSection(
        {
          market: "indices",
          calculator: "calculator",
          stock: "overview",
          assistant: "assistant",
        }[button.dataset.appPage],
        false,
      );
  });
  analysisChanged();
}

export {
  financeStock,
  financeVersion,
  simulationSignature,
  backtestVersion,
  numeric,
  analysisRequest,
  postOptions,
  clearBacktest,
  analysisChanged,
  refreshFinancialView,
  loadFinancials,
  pollFinancials,
  selectSection,
};
