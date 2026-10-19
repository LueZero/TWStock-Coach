import { taipeiDay } from "../models/stock-model.js";
import {
  el,
  markdown,
  renderConversation,
  renderResearchChart,
  artifactButton,
} from "../views/chat-view.js";
const $ = (id) => document.getElementById(id);
let session = null,
  sessions = [],
  authenticated = false,
  generation = 0,
  stream = null,
  pollTimer = null,
  elapsedTimer = null,
  lastEvent = 0,
  loading = false;
const drafts = new Map();
const draftKey = () => session?.id || "new";
const status = (text) => {
  $("assistantStatus").textContent = text;
};
async function api(path, body, method) {
  const response = await fetch("/api/assistant" + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(45000),
  });
  const value = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      authenticated = false;
      controls();
    }
    throw Error(value.detail || "助手連線失敗");
  }
  return value;
}
function controls() {
  const running = session?.turns.at(-1)?.status === "running";
  $("assistantLogin").hidden = authenticated;
  $("assistantSend").disabled = !authenticated || running || loading;
  $("chatNewSession").disabled = !authenticated || loading;
  $("assistantCancel").hidden = !running;
  $("chatRename").disabled = !session || running;
  $("chatDownload").hidden = !session;
  if (session)
    $("chatDownload").href =
      `/api/assistant/sessions/${session.id}/download?format=md`;
}
function draftSave() {
  drafts.set(draftKey(), $("assistantMessage").value);
}
function cleanup() {
  stream?.close();
  stream = null;
  clearTimeout(pollTimer);
  clearInterval(elapsedTimer);
}
function scrollBottom(force = false) {
  const box = $("chatMessages");
  if (force || box.scrollHeight - box.scrollTop - box.clientHeight < 180)
    box.scrollTop = box.scrollHeight;
}
function ask(text) {
  $("assistantMessage").value = text;
  draftSave();
  $("assistantMessage").focus();
}
function openArtifact(artifact) {
  const dialog = $("chatArtifactDialog"),
    content = $("chatArtifactContent");
  if (dialog.open) dialog.close();
  content.replaceChildren();
  $("chatArtifactTitle").textContent = artifact.title;
  dialog.showModal();
  if (artifact.type === "report") markdown(content, artifact.markdown);
  else
    renderResearchChart(content, artifact, (text) => {
      dialog.close();
      ask(text);
    });
  const link = el(
    "a",
    artifact.type === "report" ? "下載 Markdown 報告" : "下載圖表來源 JSON",
    "chat-artifact-download",
  );
  link.href = `/api/assistant/sessions/${session.id}/artifacts/${artifact.id}/download`;
  content.append(link);
}
function renderList() {
  const target = $("chatSessionList");
  target.replaceChildren();
  $("chatSessionCount").textContent = sessions.length;
  for (const item of sessions) {
    const button = el("button", null, "chat-session");
    button.type = "button";
    button.dataset.sessionId = item.id;
    button.setAttribute("aria-pressed", String(item.id === session?.id));
    button.append(
      el("strong", item.title),
      el(
        "small",
        `${
          (item.targets || (item.stock ? [item.stock] : []))
            .map((s) => s.symbol)
            .slice(0, 3)
            .join("／") || "自由提問"
        } · ${item.mode === "historical" ? "歷史" : "最新"} · ${item.turn_count} 則提問${item.status === "running" ? " · 回覆中" : ""}`,
      ),
    );
    button.onclick = () => loadSession(item.id);
    target.append(button);
  }
  if (!sessions.length)
    target.append(el("p", "還沒有對話，直接描述問題即可開始。", "subtle"));
}
async function history() {
  if (!authenticated) return;
  try {
    sessions = await api("/sessions");
    renderList();
  } catch (error) {
    status(error.message);
  }
}
function renderActivity() {
  const turn = session?.turns.at(-1),
    running = turn?.status === "running";
  $("chatActivity").hidden = !turn;
  $("chatActivity").classList.toggle("is-running", running);
  const activities = (turn?.events || []).filter((e) => e.type === "progress");
  $("chatStage").textContent =
    activities.at(-1)?.message || (running ? "AI 正在分析" : "本次回覆已結束");
  const inline = $("chatMessages").querySelector(".chat-inline-activity");
  if (inline) inline.textContent = $("chatStage").textContent;
  $("chatEvents").replaceChildren(
    ...activities
      .slice(-60)
      .map((e) =>
        el(
          "li",
          `${new Date(e.at).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei" })} · ${e.message}`,
        ),
      ),
  );
  const tick = () => {
    $("chatElapsed").textContent = turn
      ? `${Math.max(0, Math.floor(((running ? Date.now() : Date.parse(turn.finished_at || turn.started_at)) - Date.parse(turn.started_at)) / 1000))} 秒`
      : "";
  };
  tick();
  clearInterval(elapsedTimer);
  if (running) elapsedTimer = setInterval(tick, 1000);
}
function render(force = false) {
  const box = $("chatMessages"),
    position = box.scrollTop,
    atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 180;
  $("chatTitle").textContent = session?.title || "開始一段股票研究";
  $("chatScope").textContent = session
    ? `${(session.targets || (session.stock ? [session.stock] : [])).map((s) => `${s.name} ${s.symbol}`).join("、") || "依描述辨識股票，可比較多檔或詢問大盤"} · ${session.mode === "historical" ? "歷史截止 " + new Date(session.as_of).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }) : "最新資料 · 各標的分別保留截止"}`
    : "每段 Session 獨立保存，可隨時回來接著問。";
  renderConversation(session, openArtifact, ask);
  renderActivity();
  renderList();
  controls();
  if (force || atBottom) scrollBottom(true);
  else box.scrollTop = position;
}
function watch(id, v) {
  cleanup();
  lastEvent = Math.max(
    0,
    ...(session.turns.at(-1)?.events || []).map((e) => e.id),
  );
  stream = new EventSource(
    `/api/assistant/sessions/${id}/events?since=${lastEvent}`,
  );
  const current = () => v === generation && session?.id === id;
  function receive(type, event) {
    if (!current()) return;
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (data.id && data.id <= lastEvent) return;
    if (data.id) lastEvent = data.id;
    const turn = session.turns.at(-1);
    turn.events.push({ ...data, type });
    if (turn.events.length > 300) turn.events.shift();
    if (type === "assistant_text") {
      const messageId = data.message_id || String(data.id);
      const draft = turn.drafts.find((d) => d.id === messageId);
      if (draft) draft.text = data.text;
      else turn.drafts.push({ id: messageId, text: data.text });
      const body = $("chatMessages").querySelector(
        `[data-turn-id="${turn.id}"] .chat-answer`,
      );
      if (body) {
        const box = $("chatMessages");
        const following =
          box.scrollHeight - box.scrollTop - box.clientHeight < 180;
        body.querySelector(".chat-thinking")?.remove();
        let part = Array.from(body.children).find(
          (node) => node.dataset.messageId === messageId,
        );
        if (!part) {
          part = el("div", null, "chat-stream-part");
          part.dataset.messageId = messageId;
          body.append(part);
        }
        part.replaceChildren();
        markdown(part, data.text);
        if (following) scrollBottom(true);
      }
    } else if (type === "artifact") {
      if (!turn.artifacts.some((a) => a.id === data.artifact.id)) {
        turn.artifacts.push(data.artifact);
        $("chatMessages")
          .querySelector(`[data-turn-id="${turn.id}"] .chat-artifacts`)
          ?.append(artifactButton(data.artifact, openArtifact));
        scrollBottom();
      }
    }
    renderActivity();
  }
  for (const type of ["progress", "assistant_text", "artifact"])
    stream.addEventListener(type, (event) => receive(type, event));
  stream.addEventListener("done", () => {
    if (current()) {
      stream?.close();
      stream = null;
      poll(id, v, true);
    }
  });
  stream.onerror = () => {
    if (current()) status("即時連線重連中；對話仍在執行，會自動確認結果。");
  };
  pollTimer = setTimeout(() => poll(id, v), 2500);
}
async function poll(id, v, final = false) {
  clearTimeout(pollTimer);
  try {
    const value = await api("/sessions/" + id);
    if (v !== generation || session?.id !== id) return;
    const oldTurn = session.turns.at(-1),
      newTurn = value.turns.at(-1);
    if (newTurn?.status !== "running") {
      session = value;
      cleanup();
      render();
      status(
        newTurn?.status === "completed"
          ? "回答已保存，可以繼續追問。"
          : newTurn?.error || "對話已載入。",
      );
      history();
      return;
    }
    // Polling is a recovery path when SSE misses text/artifact events.
    if ((newTurn.events.at(-1)?.id || 0) > (oldTurn.events.at(-1)?.id || 0)) {
      session = value;
      lastEvent = Math.max(lastEvent, ...newTurn.events.map((e) => e.id));
      render();
    }
    pollTimer = setTimeout(() => poll(id, v), 3000);
  } catch (error) {
    if (v === generation) {
      status(`連線暫時中斷：${error.message}；稍後自動重試。`);
      pollTimer = setTimeout(() => poll(id, v), 4000);
    }
  }
}
async function loadSession(id) {
  draftSave();
  cleanup();
  const v = ++generation;
  loading = true;
  controls();
  try {
    const value = await api("/sessions/" + id);
    if (v !== generation) return;
    session = value;
    localStorage.setItem("stock-coach-chat-session", id);
    $("assistantMessage").value = drafts.get(id) || "";
    render(true);
    status("已開啟獨立對話，訊息與資料來源保留。");
    if (value.turns.at(-1)?.status === "running") watch(id, v);
  } catch (error) {
    if (v === generation) status(error.message);
  } finally {
    if (v === generation) {
      loading = false;
      controls();
    }
  }
}
async function createSession() {
  draftSave();
  const mode = $("chatNewMode").value;
  const body = { mode };
  if (mode === "historical") {
    const date = $("chatNewCutoff").value;
    if (!date) throw Error("請選擇歷史截止日期");
    body.as_of = date + "T23:59:59+08:00";
    if (Date.parse(body.as_of) > Date.now())
      throw Error("歷史截止需為已結束的日期；今天請使用最新模式。");
  }
  const created = await api("/sessions", body);
  await history();
  await loadSession(created.id);
  return created;
}
async function send() {
  const message = $("assistantMessage").value.trim();
  if (
    !message ||
    loading ||
    !authenticated ||
    session?.turns.at(-1)?.status === "running"
  )
    return;
  loading = true;
  controls();
  try {
    if (!session) await createSession();
    loading = true;
    controls();
    const id = session.id,
      v = ++generation;
    const response = await api(`/sessions/${id}/messages`, { message });
    if (session?.id !== id || v !== generation) return;
    session.turns.push({
      id: response.turn_id,
      message,
      status: "running",
      started_at: new Date().toISOString(),
      drafts: [],
      artifacts: [],
      tool_calls: [],
      events: [],
    });
    session.title = response.title || session.title;
    drafts.delete(id);
    $("assistantMessage").value = "";
    render(true);
    status("訊息已送出，Codex 將依問題選擇資料工具。");
    watch(id, v);
    history();
  } catch (error) {
    status(error.message);
  } finally {
    loading = false;
    controls();
  }
}
async function checkService() {
  try {
    const value = await api("/status");
    authenticated = value.authenticated;
    $("assistantServiceBadge").textContent = value.ready
      ? "● Codex 訂閱已連線"
      : "Codex 尚未就緒";
    status(value.note);
    controls();
    if (authenticated) {
      await history();
      if (!session) {
        const id = localStorage.getItem("stock-coach-chat-session");
        if (sessions.some((s) => s.id === id)) await loadSession(id);
        else if (value.active_session) await loadSession(value.active_session);
      }
    }
  } catch (error) {
    status(error.message);
  }
}
export function initAssistantController() {
  let compact = window.innerWidth < 800;
  const fitChat = () => {
    if (document.body.dataset.page !== "assistant") return;
    const nextCompact = window.innerWidth < 800;
    if (nextCompact && !compact) $("chatSessionDrawer").open = false;
    compact = nextCompact;
    const shell = document.querySelector(".chat-shell");
    const height = window.visualViewport?.height || window.innerHeight;
    shell.style.height = `${Math.max(320, height - shell.getBoundingClientRect().top - 12)}px`;
  };
  window.addEventListener("resize", fitChat);
  window.visualViewport?.addEventListener("resize", fitChat);
  const layoutObserver = new ResizeObserver(fitChat);
  layoutObserver.observe($("assistantLogin"));
  layoutObserver.observe(document.querySelector(".chat-page-heading"));
  document.addEventListener("stock-coach:section", () =>
    requestAnimationFrame(fitChat),
  );
  $("chatSessionDrawer").addEventListener("toggle", () => {
    fitChat();
  });
  $("chatMessages").addEventListener("scroll", () => {
    const box = $("chatMessages");
    $("chatLatest").hidden =
      box.scrollHeight - box.scrollTop - box.clientHeight < 180;
  });
  $("chatLatest").onclick = () => scrollBottom(true);
  $("chatNewCutoff").max = taipeiDay();
  $("chatNewCutoff").value = taipeiDay();
  $("chatNewMode").onchange = () => {
    $("chatCutoffLabel").hidden = $("chatNewMode").value !== "historical";
  };
  if (window.innerWidth < 800) $("chatSessionDrawer").open = false;
  $("chatNewSession").onclick = async () => {
    if (loading) return;
    loading = true;
    controls();
    try {
      await createSession();
      if (window.innerWidth < 800) $("chatSessionDrawer").open = false;
    } catch (error) {
      status(error.message);
    } finally {
      loading = false;
      controls();
    }
  };
  $("assistantMessageForm").onsubmit = (e) => {
    e.preventDefault();
    send();
  };
  $("assistantMessage").oninput = draftSave;
  $("assistantMessage").onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  };
  $("assistantLogin").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api("/login", { access_key: $("assistantAccessKey").value });
      $("assistantAccessKey").value = "";
      await checkService();
    } catch (error) {
      status(error.message);
    }
  };
  $("assistantCancel").onclick = async () => {
    if (!session) return;
    try {
      await api(`/sessions/${session.id}/cancel`, {});
      status("正在停止本次回覆，先前訊息與已產生內容保留。");
    } catch (error) {
      status(error.message);
    }
  };
  $("chatRename").onclick = async () => {
    if (!session) return;
    const title = window.prompt("對話名稱", session.title);
    if (!title?.trim()) return;
    try {
      session = await api(
        `/sessions/${session.id}`,
        { title: title.trim() },
        "PATCH",
      );
      render();
      await history();
    } catch (error) {
      status(error.message);
    }
  };
  $("chatArtifactClose").onclick = () => $("chatArtifactDialog").close();
  document
    .querySelectorAll("[data-chat-prompt]")
    .forEach(
      (button) => (button.onclick = () => ask(button.dataset.chatPrompt)),
    );
  document.addEventListener("stock-coach:section", (event) => {
    if (event.detail.view === "assistant") checkService();
  });
  render();
  controls();
}
