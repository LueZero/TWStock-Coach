import { state, stockKey, taipeiDay, shiftDay } from "../models/stock-model.js";
import { selectSection } from "./analysis-controller.js";
import { restartHistory } from "./dashboard-controller.js";
import { plot } from "../views/dashboard-view.js";
import {
  closeProgressStream,
  resetProgress,
  progressEvent,
  watchProgress,
  beginProgress,
  failProgress,
} from "./assistant-stream.js";
import {
  renderAssistantReport,
  renderMessages,
  element,
} from "../views/assistant-view.js";
const $ = (id) => document.getElementById(id);
let report = null,
  tab = "summary",
  version = 0,
  pollTimer = null,
  jobId = null,
  busy = false,
  authenticated = false,
  selected = null,
  messages = [];
let reportRun = null;
const key = () => stockKey();
function watch(id, v, stock) {
  clearTimeout(pollTimer);
  status("分析已啟動，執行進度會即時更新；完成後自動保存報告。");
  watchProgress(id, {
    current: () => v === version && stock === key(),
    onDone: () => {
      finishJob();
      poll(id, v, stock);
    },
    onFallback: () => {
      clearTimeout(pollTimer);
      pollTimer = setTimeout(() => poll(id, v, stock), 3000);
    },
  });
}
async function api(path, body) {
  const response = await fetch("/api/assistant" + path, {
    ...(body !== undefined
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
    signal: AbortSignal.timeout(45000),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      authenticated = false;
      controls();
    }
    throw Error(data.detail || "助手暫時無法使用");
  }
  return data;
}
function status(text) {
  $("assistantStatus").textContent = text;
}
function controls() {
  $("assistantLogin").hidden = authenticated;
  $("assistantGenerate").disabled = !authenticated || busy;
  $("assistantSend").disabled = !authenticated || busy;
  $("assistantCancel").hidden = !jobId;
}
function render() {
  renderAssistantReport(report, tab, {
    run: reportRun,
    tab: (value) => {
      tab = value;
      render();
    },
    evidence: (ids) => {
      tab = "evidence";
      render();
      const id = ids[0]?.replaceAll(":", "-");
      document
        .getElementById("assistant-evidence-" + id)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
    bar: (row) => {
      selected = row;
      $("assistantMode").value = "historical";
      $("assistantMessage").value =
        `請依 ${row.trade_date} 當時可得資料分析這根完成日K。`;
      status(
        `選取 ${row.trade_date} 收盤 ${row.close}；按產生新報告／送出建立當時資料包，避免使用之後的資訊。`,
      );
    },
    dashboard: async (value) => {
      $("priceBasis").value = "raw";
      $("resolution").value = "1d";
      state.resolution = "1d";
      state.chart = "daily";
      state.mode = "history";
      $("startDate").value = value.meta.start;
      $("endDate").value = value.meta.end;
      selectSection("overview", false);
      await restartHistory();
      state.assistantOverlay = value;
      plot();
    },
  });
}
async function checkService() {
  try {
    const data = await api("/status");
    authenticated = data.authenticated;
    $("assistantServiceBadge").textContent = data.ready
      ? "Codex 已連線"
      : "平台條件模式";
    controls();
    if (!busy) status(data.note);
    if (data.active_report && !busy && !report) {
      const doc = await api("/reports/" + data.active_report);
      if (doc.report.meta.market + ":" + doc.report.meta.symbol === key())
        await loadReport(data.active_report);
    }
    return data;
  } catch (error) {
    status(error.message);
  }
}
async function history() {
  if (!authenticated) return;
  const stock = key(),
    v = version;
  try {
    const values = await api(
      `/reports?market=${state.stock.market}&symbol=${state.stock.symbol}`,
    );
    if (stock !== key() || v !== version) return;
    const select = $("assistantHistory");
    select.replaceChildren(element("option", "選擇報告版本"));
    select.firstChild.value = "";
    for (const r of values) {
      const option = element(
        "option",
        `${new Date(r.created_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })} · ${r.status_label}`,
      );
      option.value = r.id;
      select.append(option);
    }
    if (report) select.value = report.id;
  } catch (error) {
    status(error.message);
  }
}
async function loadReport(id) {
  closeProgressStream();
  const v = ++version,
    stock = key();
  clearTimeout(pollTimer);
  jobId = null;
  busy = true;
  controls();
  try {
    const data = await api("/reports/" + id);
    if (v !== version || stock !== key()) return;
    if (data.report.meta.market + ":" + data.report.meta.symbol !== stock)
      throw Error("報告股票與目前選取不符");
    report = data.report;
    reportRun = data.run;
    selected = null;
    messages = data.messages;
    resetProgress(data.progress_events, data.run);
    tab = "summary";
    render();
    renderMessages(messages, report?.evidence);
    status(
      report.ai
        ? "已讀取AI報告；追問會依本次查詢時點取得資料，歷史模式維持原截止。"
        : "已讀取平台條件報告。",
    );
    if (
      ["failed", "cancelled", "interrupted", "unavailable"].includes(
        data.run?.status,
      )
    )
      status(
        data.run.error || "先前分析未完成，報告檔案保留，可重新分析或追問。",
      );
    $("assistantMode").value = report.meta.mode;
    $("assistantStart").value = report.meta.start;
    $("assistantRangeMode").value = report.meta.range_mode || "manual";
    syncRangeControls();
    if (data.run?.status === "running") {
      jobId = data.report.id;
      watch(jobId, v, stock);
    }
  } catch (error) {
    if (v === version) status(error.message);
  } finally {
    if (v === version) {
      busy = !!jobId;
      controls();
    }
  }
}
function syncRangeControls() {
  const manual = $("assistantRangeMode").value === "manual";
  $("assistantStartLabel").hidden = !manual;
  $("assistantRangeSummary").textContent = manual
    ? "資料期間 · 指定起日"
    : "資料期間 · 自動";
}
function request(message) {
  const mode = $("assistantMode").value;
  if (mode === "historical" && !selected && !state.selected)
    throw Error("請先在K線引導或個股看盤選取完成日K，再建立當時報告。");
  const bar = selected || state.selected;
  const body = {
    market: state.stock.market,
    symbol: state.stock.symbol,
    range_mode: $("assistantRangeMode").value,
    mode,
    message,
  };
  if (body.range_mode === "manual") body.start = $("assistantStart").value;
  if (mode === "historical") {
    if (bar.is_final === false) throw Error("未完成K線不產生正式歷史報告");
    body.as_of = bar.end_time || bar.trade_date + "T13:30:00+08:00";
    if (body.start && body.start > bar.trade_date)
      throw Error("指定起日不可晚於選取的歷史日K。");
  }
  return body;
}
function finishJob() {
  closeProgressStream();
  clearTimeout(pollTimer);
  busy = false;
  jobId = null;
  controls();
}
async function poll(id, v, stock) {
  try {
    const value = await api("/reports/" + id);
    const job = value.run;
    if (v !== version || stock !== key()) return;
    reportRun = job;
    if (job.status === "running") {
      for (const event of value.progress_events || []) progressEvent(event);
      status(
        value.progress_events?.at(-1)?.message ||
          (job.phase === "analyzing"
            ? "資料與缺漏已整理，AI正在核對各面向與進出場條件；完整報告可能需要數分鐘，完成後自動保存。"
            : "正在整理這檔股票的平台資料，接著交給AI分析。"),
      );
      pollTimer = setTimeout(() => poll(id, v, stock), 2000);
      return;
    }
    if (job.status === "completed") {
      if (v !== version || stock !== key()) return;
      report = value.report;
      messages = value.messages;
      render();
      renderMessages(messages, report?.evidence);
      status("AI回答已驗證並保存；追問會重新核對本次截止內資料。");
    } else {
      report = value.report;
      render();
      status(
        job.error ||
          (job.status === "cancelled"
            ? "已取消AI分析；平台條件報告保留。"
            : "分析中斷，原報告保留，可重新送出。"),
      );
    }
    finishJob();
    resetProgress(value.progress_events, value.run);
    await history();
  } catch (error) {
    if (v !== version || stock !== key()) return;
    if (!jobId) {
      status(
        `工作已結束，但報告讀取失敗：${error.message}；可從已存報告重試。`,
      );
      return;
    }
    status(
      `連線中斷：${error.message}；工作可能仍在執行，稍後讀取報告或取消。`,
    );
    pollTimer = setTimeout(() => poll(id, v, stock), 5000);
  }
}
async function generate(
  message = "請用新手能理解的方式分析目前狀態、進場與退出條件；資料不足請直接說明。",
) {
  if (busy) return;
  let body;
  try {
    body = request(message);
  } catch (error) {
    status(error.message);
    return;
  }
  const v = ++version,
    stock = key();
  busy = true;
  controls();
  status("正在更新最近行情，再固定資料截止並整理分析資訊…");
  beginProgress();
  try {
    const packetResponse = await fetch("/api/research/report-input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
    const packet = await packetResponse.json();
    if (!packetResponse.ok) throw Error(packet.detail || "股票資料包無法取得");
    if (v !== version || stock !== key()) return;
    const data = await api("/reports", { ...packet, message });
    if (v !== version || stock !== key()) return;
    resetProgress([], data.run);
    report = data.report;
    reportRun = data.run;
    selected = null;
    tab = "summary";
    messages = [{ role: "user", content: { text: message } }];
    render();
    renderMessages(messages, report?.evidence);
    $("assistantMessage").value = "";
    await history();
    if (data.status === "running") {
      jobId = data.report.id;
      controls();
      watch(jobId, v, stock);
    } else {
      finishJob();
      status(
        "平台條件報告已建立。Codex尚未連線／登入，AI解讀未執行；可查看條件、資料品質與K線。",
      );
    }
  } catch (error) {
    if (v === version) {
      status(error.message);
      finishJob();
      failProgress(error.message);
    }
  }
}
async function send() {
  const message = $("assistantMessage").value.trim();
  if (!message || busy) return;
  if (!report || selected || $("assistantMode").value !== report.meta.mode) {
    selected = selected || state.selected;
    return generate(message);
  }
  const v = ++version,
    stock = key();
  busy = true;
  controls();
  beginProgress();
  try {
    const data = await api(`/reports/${report.id}/messages`, { message });
    if (v !== version || stock !== key()) return;
    resetProgress([], data.run);
    messages.push({ role: "user", content: { text: message } });
    renderMessages(messages, report?.evidence);
    $("assistantMessage").value = "";
    if (data.status === "running") {
      jobId = data.report_id;
      controls();
      watch(jobId, v, stock);
    } else {
      finishJob();
      status("Codex尚未連線，訊息已保存；平台報告仍可查看。");
    }
  } catch (error) {
    if (v === version) {
      status(error.message);
      finishJob();
      failProgress(error.message);
    }
  }
}
export function initAssistantController() {
  $("assistantStart").value = shiftDay(taipeiDay(), -180);
  $("assistantStart").max = taipeiDay();
  $("assistantRangeMode").onchange = syncRangeControls;
  $("assistantLogin").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api("/login", { access_key: $("assistantAccessKey").value });
      $("assistantAccessKey").value = "";
      await checkService();
      await history();
    } catch (error) {
      status(error.message);
    }
  };
  $("assistantGenerate").onclick = () => generate();
  $("assistantMessageForm").onsubmit = (e) => {
    e.preventDefault();
    send();
  };
  $("assistantCancel").onclick = async () => {
    if (!jobId) return;
    try {
      await api(`/reports/${jobId}/cancel`, {});
      status("正在取消CLI分析；已保存的報告保留。");
    } catch (error) {
      status(error.message);
    }
  };
  $("assistantHistory").onchange = () => {
    if ($("assistantHistory").value) loadReport($("assistantHistory").value);
  };
  document.querySelectorAll("[data-report-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.reportTab;
        render();
      }),
  );
  document.querySelectorAll("[data-assistant-question]").forEach(
    (b) =>
      (b.onclick = () => {
        $("assistantMessage").value = b.dataset.assistantQuestion;
        $("assistantMessage").focus();
      }),
  );
  $("assistantToggleChat").onclick = () => {
    const hidden = !$("assistantChat").hidden;
    $("assistantChat").hidden = hidden;
    $("assistantPanel")
      .querySelector(".assistant-workspace")
      .classList.toggle("chat-hidden", hidden);
    $("assistantToggleChat").textContent = hidden ? "展開聊天" : "收合聊天";
    $("assistantToggleChat").setAttribute("aria-expanded", String(!hidden));
    if (tab === "chart") render();
  };
  document.addEventListener("stock-coach:stock", () => {
    version++;
    resetProgress();
    clearTimeout(pollTimer);
    report = null;
    selected = null;
    jobId = null;
    busy = false;
    messages = [];
    $("assistantMessage").value = "";
    $("assistantTitle").textContent =
      `${state.stock.name} ${state.stock.symbol} · 個股分析報告`;
    $("assistantMeta").textContent = "產生新報告或讀取這檔股票的已存版本。";
    render();
    renderMessages();
    controls();
    history();
  });
  document.addEventListener("stock-coach:section", async (e) => {
    if (e.detail.view !== "assistant") return;
    $("assistantTitle").textContent =
      `${state.stock.name} ${state.stock.symbol} · 個股分析報告`;
    await checkService();
    await history();
    render();
  });
  document.addEventListener("stock-coach:bar", (e) => {
    selected = e.detail.row;
  });
  window.addEventListener("resize", () => {
    if (
      tab === "chart" &&
      report &&
      $("dashboardGrid").dataset.view === "assistant"
    )
      render();
  });
  controls();
}
