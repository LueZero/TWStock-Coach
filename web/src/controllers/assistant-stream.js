const $ = (id) => document.getElementById(id);
let stream = null,
  clock = null,
  started = 0,
  lastActivity = 0,
  lastId = 0;
const phases = {
  refreshing: "更新行情",
  preparing: "整理資料",
  starting: "啟動Codex",
  analyzing: "分析中",
  querying: "補查資料",
  writing: "撰寫報告",
  validating: "驗證報告",
  completed: "分析完成",
  failed: "分析失敗",
  cancelled: "已取消",
  interrupted: "服務中斷",
};
export function closeProgressStream() {
  stream?.close();
  stream = null;
  clearInterval(clock);
  clock = null;
}
export function progressEvent(event) {
  if (started && Date.parse(event.at) < started) return;
  if (event.id <= lastId) return;
  lastId = event.id;
  $("assistantProgress").hidden = false;
  $("assistantProgress").dataset.running = String(
    !["completed", "failed", "cancelled", "interrupted"].includes(event.phase),
  );
  lastActivity = Date.parse(event.at) || Date.now();
  if (!started) started = lastActivity;
  $("assistantProgressStage").textContent = phases[event.phase] || "分析中";
  $("assistantProgressLatest").textContent = event.message;
  const row = document.createElement("li");
  row.textContent = `${new Date(event.at).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei" })} · ${event.message}`;
  $("assistantProgressEvents").append(row);
  while ($("assistantProgressEvents").children.length > 60)
    $("assistantProgressEvents").firstChild.remove();
}
export function resetProgress(events = [], run = {}) {
  closeProgressStream();
  lastId = 0;
  started = Date.parse(run.started_at) || 0;
  lastActivity = 0;
  $("assistantProgressEvents").replaceChildren();
  $("assistantProgress").hidden = !events.length;
  for (const event of events) progressEvent(event);
  if (run.status) {
    $("assistantProgress").dataset.running = String(run.status === "running");
    if (run.status !== "running")
      $("assistantProgressStage").textContent = phases[run.status] || "已結束";
    if (run.error) $("assistantProgressLatest").textContent = run.error;
    else if (run.status === "completed")
      $("assistantProgressLatest").textContent = "報告已驗證並保存";
  }
  $("assistantProgressConnection").textContent =
    run.status === "running" ? "連線中" : "執行紀錄";
  $("assistantProgressTime").textContent =
    run.started_at && run.finished_at
      ? `執行 ${Math.max(0, Math.round((Date.parse(run.finished_at) - Date.parse(run.started_at)) / 1000))} 秒`
      : "已執行 0 秒";
}
export function beginProgress() {
  resetProgress();
  progressEvent({
    id: 1,
    at: new Date().toISOString(),
    phase: "preparing",
    message: "正在取得平台資料包，接著啟動AI分析",
  });
  lastId = 0;
}
export function failProgress(message) {
  progressEvent({
    id: lastId + 1,
    at: new Date().toISOString(),
    phase: "failed",
    message,
  });
  $("assistantProgressConnection").textContent = "工作未完成";
}
export function watchProgress(id, { current, onDone, onFallback }) {
  closeProgressStream();
  stream = new EventSource(`/api/assistant/reports/${id}/events`);
  const source = stream;
  const valid = () => current() && stream === source;
  source.onopen = () => {
    if (valid()) $("assistantProgressConnection").textContent = "即時連線正常";
  };
  source.addEventListener("progress", (e) => {
    if (valid()) progressEvent(JSON.parse(e.data));
  });
  source.addEventListener("heartbeat", (e) => {
    if (!valid()) return;
    const beat = JSON.parse(e.data);
    if (beat.started_at) started = Date.parse(beat.started_at);
    $("assistantProgressConnection").textContent = "即時連線正常";
  });
  source.addEventListener("done", () => {
    if (valid()) {
      closeProgressStream();
      $("assistantProgressConnection").textContent = "本次執行已結束";
      onDone();
    }
  });
  source.onerror = () => {
    if (valid()) {
      $("assistantProgressConnection").textContent = "串流重連中，正在核對工作";
      onFallback();
    }
  };
  clock = setInterval(() => {
    if (started)
      $("assistantProgressTime").textContent =
        `已執行 ${Math.max(0, Math.floor((Date.now() - started) / 1000))} 秒${lastActivity ? ` · 最近活動 ${Math.max(0, Math.floor((Date.now() - lastActivity) / 1000))} 秒前` : ""}`;
  }, 1000);
}
