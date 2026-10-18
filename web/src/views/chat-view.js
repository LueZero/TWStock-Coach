import {
  renderTechnicalMarkers,
  signalCategories,
} from "./technical-markers.js";
export const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
function inline(target, text) {
  const pattern =
    /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    target.append(document.createTextNode(text.slice(offset, match.index)));
    if (match[1]) target.append(el("strong", match[1]));
    else if (match[2]) target.append(el("code", match[2]));
    else {
      const a = el("a", match[3]);
      a.href = match[4];
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      target.append(a);
    }
    offset = match.index + match[0].length;
  }
  target.append(document.createTextNode(text.slice(offset)));
}
// Construct DOM nodes only; model prose and source HTML never become innerHTML.
export function markdown(target, text) {
  const lines = String(text || "").split("\n");
  let list = null,
    code = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      if (code) {
        target.append(code);
        code = null;
      } else code = el("pre", "");
      continue;
    }
    if (code) {
      code.textContent += line + "\n";
      continue;
    }
    if (!line.trim()) {
      list = null;
      continue;
    }
    if (line.includes("|") && /^\s*\|?\s*:?-{3}/.test(lines[i + 1] || "")) {
      const wrap = el("div", null, "chat-table"),
        table = el("table"),
        head = el("thead"),
        body = el("tbody");
      const cells = (s) =>
        s
          .replace(/^\s*\||\|\s*$/g, "")
          .split("|")
          .map((v) => v.trim());
      const tr = el("tr");
      for (const value of cells(line)) {
        const th = el("th");
        inline(th, value);
        tr.append(th);
      }
      head.append(tr);
      i++;
      while ((lines[i + 1] || "").includes("|") && lines[i + 1].trim()) {
        const row = el("tr");
        for (const value of cells(lines[++i])) {
          const td = el("td");
          inline(td, value);
          row.append(td);
        }
        body.append(row);
      }
      table.append(head, body);
      wrap.append(table);
      target.append(wrap);
      list = null;
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line),
      item = /^\s*(?:[-*]|\d+[.)])\s+(.+)$/.exec(line);
    if (heading) {
      const h = el("h" + Math.min(heading[1].length + 2, 6));
      inline(h, heading[2]);
      target.append(h);
      list = null;
    } else if (item) {
      if (!list) {
        list = el("ul");
        target.append(list);
      }
      const li = el("li");
      inline(li, item[1]);
      list.append(li);
    } else {
      list = null;
      const p = el("p");
      inline(p, line);
      target.append(p);
    }
  }
  if (code) target.append(code);
}
const stamp = (value) =>
  value
    ? new Date(value).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })
    : "未查詢市場資料";
const labels = {
  get_stock_quote: "個股行情與五檔",
  get_stock_data: "平台資料",
  get_financial_history: "歷年財務",
  get_chip_detail: "籌碼明細",
  calculate_trade_profit: "價差／毛損益試算",
  show_stock_chart: "K線引導",
  save_research_report: "研究報告",
};
const sectionLabels = {
  overview: "研究範圍",
  technical: "技術指標",
  basic: "基本分析",
  financial: "財務分析",
  chips: "籌碼分析",
  peers: "同業比較",
  news: "新聞與公開討論",
  market: "大盤市場",
  scenarios: "技術價位參考",
};
export function renderSources(turn) {
  const calls = turn.tool_calls.filter(
    (c) => !c.artifact && !["skill", "discovery"].includes(c.category),
  );
  if (!calls.length) return null;
  const details = el("details", null, "chat-sources");
  details.append(
    el(
      "summary",
      `本次查詢依據 · ${calls.length} 項 · ${new Set(calls.filter((c) => c.symbol).map((c) => `${c.market}:${c.symbol}`)).size > 1 ? "各標的時間分別列示" : "截止 " + stamp(calls.find((c) => c.as_of)?.as_of || turn.scope?.as_of)}`,
    ),
  );
  for (const call of calls) {
    const item = el("details");
    item.append(
      el(
        "summary",
        `${call.target ? `${call.target.name} ${call.target.symbol} · ` : ""}${labels[call.name] || call.name}${call.arguments?.section ? " · " + (sectionLabels[call.arguments.section] || call.arguments.section) : ""} · ${call.status === "completed" ? "查詢完成" : "查詢失敗"}`,
      ),
    );
    item.append(
      el(
        "p",
        `${call.as_of ? "查詢截止 " + stamp(call.as_of) + " · " : ""}${call.evidence_id || call.error || ""}`,
      ),
    );
    item.addEventListener("toggle", () => {
      if (item.open && !item.querySelector("pre"))
        item.append(
          el(
            "pre",
            JSON.stringify(
              {
                as_of: call.as_of,
                start: call.start,
                end: call.end,
                endpoint: call.endpoint,
                data: call.data,
                evidence: call.evidence,
              },
              null,
              2,
            ),
          ),
        );
    });
    details.append(item);
  }
  return details;
}
export function artifactButton(artifact, onOpen) {
  const button = el("button", null, "chat-artifact-card");
  button.type = "button";
  button.append(
    el("span", artifact.type === "chart" ? "▥ K 線引導" : "▤ 研究報告"),
    el("strong", artifact.title),
    el("small", `${stamp(artifact.created_at)} · 點擊展開`),
  );
  button.onclick = () => onOpen(artifact);
  return button;
}
export function renderConversation(session, openArtifact, ask) {
  const target = document.getElementById("chatMessages");
  target.replaceChildren();
  if (!session?.turns.length) {
    const welcome = el("div", null, "chat-welcome");
    welcome.append(
      el("span", "✦"),
      el("h3", "想研究什麼，直接告訴我"),
      el(
        "p",
        "可以說「分析凱基金」、「比較友達與群創」，或問大盤與投資概念。我會辨識標的、按需查資料，必要時提供報告與K線。",
      ),
      el("small", "新對話各自獨立；不會自動生成整份報告。"),
    );
    target.append(welcome);
    return;
  }
  for (const turn of session.turns) {
    const user = el("article", null, "chat-message chat-user");
    user.append(el("small", "你"), el("p", turn.message));
    target.append(user);
    const ai = el("article", null, "chat-message chat-ai");
    ai.dataset.turnId = turn.id;
    ai.append(el("small", "✦ 股票助手"));
    const body = el("div", null, "chat-answer");
    if (turn.answer) markdown(body, turn.answer);
    else if (turn.status === "running") {
      for (const draft of turn.drafts || []) markdown(body, draft.text);
      if (!body.childElementCount)
        body.append(el("p", "正在理解問題與選擇資料…", "chat-thinking"));
    } else body.append(el("p", turn.error || "本次回覆已停止。", "chat-error"));
    ai.append(body);
    const skills = turn.tool_calls.filter(
      (c) => c.category === "skill" && c.status === "completed",
    );
    if (skills.length) {
      const skillNames = {
        "twstock-evidence": "標的與資料查證",
        "twstock-technical": "技術走勢",
        "twstock-compare": "比較與報告",
        "twstock-position": "持倉與損益",
      };
      const badges = el("div", null, "chat-skill-badges");
      for (const call of skills) {
        const badge = el("span", skillNames[call.data.name] || call.data.name);
        badge.title = `${call.data.name} · ${call.data.version}`;
        badges.append(badge);
      }
      ai.append(badges);
    }
    const artifacts = el("div", null, "chat-artifacts");
    for (const artifact of turn.artifacts)
      artifacts.append(artifactButton(artifact, openArtifact));
    ai.append(artifacts);
    const sources = renderSources(turn);
    if (sources) ai.append(sources);
    if (turn.answer) {
      const follow = el("button", "請用K線說明這段分析", "chat-follow quiet");
      follow.onclick = () => ask("請顯示K線，解釋上一則回答提到的趨勢與訊號。");
      ai.append(follow);
    }
    target.append(ai);
  }
}
export function renderResearchChart(target, artifact, ask) {
  const all = artifact.bars;
  if (!all?.length) {
    target.append(el("p", "此圖表沒有完成日K。"));
    return;
  }
  let count = Math.min(60, all.length),
    offset = Math.max(0, all.length - count),
    filter = "all",
    focused =
      all.find((b) => b.trade_date === artifact.focus_date) || all.at(-1);
  const tools = el("div", null, "chat-chart-tools"),
    caption = el("span"),
    select = el("select");
  for (const [value, label] of signalCategories) {
    const option = el("option", label);
    option.value = value;
    select.append(option);
  }
  select.setAttribute("aria-label", "技術訊號種類");
  const chart = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  chart.setAttribute("role", "img");
  chart.setAttribute("aria-label", "完成日K與技術訊號");
  chart.classList.add("chat-chart");
  const readout = el("div", null, "chat-chart-readout"),
    explain = el("button", "詢問這根K棒", "quiet");
  const observe = (row) => {
    focused = row;
    readout.replaceChildren(
      el(
        "strong",
        `${row.trade_date} · 開 ${row.open} ／ 高 ${row.high} ／ 低 ${row.low} ／ 收 ${row.close}`,
      ),
      el(
        "p",
        `${row.technical_state?.label || ""} · MA5 ${row.ma5?.toFixed(2) ?? "—"} ／ MA20 ${row.ma20?.toFixed(2) ?? "—"} ／ MA60 ${row.ma60?.toFixed(2) ?? "—"}`,
      ),
    );
    for (const event of row.technical_events || [])
      readout.append(el("p", `${event.label}：${event.note}`));
  };
  const change = (n, step = 0) => {
    count = Math.min(all.length, Math.max(Math.min(10, all.length), n));
    offset = Math.min(
      Math.max(0, offset + step),
      Math.max(0, all.length - count),
    );
    draw();
  };
  for (const [label, fn] of [
    ["←", () => change(count, -Math.ceil(count / 3))],
    ["→", () => change(count, Math.ceil(count / 3))],
    ["放大", () => change(Math.round(count * 0.7))],
    ["縮小", () => change(Math.round(count * 1.4))],
  ]) {
    const b = el("button", label, "quiet");
    b.onclick = fn;
    tools.append(b);
  }
  tools.append(select, caption);
  select.onchange = () => {
    filter = select.value;
    draw();
  };
  explain.onclick = () =>
    ask(
      `請解釋${artifact.target ? `${artifact.target.name} ${artifact.target.symbol}` : artifact.scope?.symbol || "此圖表標的"}在${focused.trade_date}這根日K及當日技術事件，區分當時訊號與後續走勢。`,
    );
  target.append(
    tools,
    chart,
    readout,
    explain,
    el("p", artifact.note, "subtle"),
  );
  const draw = () => {
    chart.replaceChildren();
    const rows = all.slice(offset, offset + count),
      width = Math.max(280, chart.clientWidth || 800),
      height = 370,
      left = 12,
      right = width - 64,
      top = 30,
      bottom = height - 36;
    chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const prices = rows
      .flatMap((r) => [r.low, r.high, r.ma5, r.ma20, r.ma60])
      .filter((v) => typeof v === "number" && Number.isFinite(v));
    const min = Math.min(...prices),
      max = Math.max(...prices),
      pad = Math.max((max - min) * 0.15, max * 0.01),
      lo = min - pad,
      hi = max + pad;
    const x = (i) => left + ((i + 0.5) * (right - left)) / rows.length,
      y = (p) => top + ((hi - p) / (hi - lo)) * (bottom - top);
    const node = (tag, attrs, text) => {
      const n = document.createElementNS(chart.namespaceURI, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      if (text != null) n.textContent = text;
      chart.append(n);
      return n;
    };
    for (let i = 0; i < 5; i++) {
      const p = lo + ((hi - lo) * i) / 4;
      node("line", {
        x1: left,
        x2: right,
        y1: y(p),
        y2: y(p),
        stroke: "#213c50",
      });
      node(
        "text",
        { x: right + 5, y: y(p) + 4, fill: "#a9c4d8", "font-size": 12 },
        p.toFixed(2),
      );
    }
    for (const [key, color] of [
      ["ma5", "#ffd166"],
      ["ma20", "#6abefa"],
      ["ma60", "#bd9aff"],
    ]) {
      let d = "",
        valid = false;
      rows.forEach((r, i) => {
        if (typeof r[key] !== "number") {
          valid = false;
          return;
        }
        d += `${valid ? "L" : "M"}${x(i)},${y(r[key])} `;
        valid = true;
      });
      node("path", { d, stroke: color, fill: "none", "stroke-width": 1.5 });
    }
    rows.forEach((r, i) => {
      const color = r.close >= r.open ? "#f27b8c" : "#53c9a2",
        w = Math.max(1, ((right - left) / rows.length) * 0.55);
      node("line", {
        x1: x(i),
        x2: x(i),
        y1: y(r.high),
        y2: y(r.low),
        stroke: color,
      });
      node("rect", {
        x: x(i) - w / 2,
        y: Math.min(y(r.open), y(r.close)),
        width: w,
        height: Math.max(1, Math.abs(y(r.open) - y(r.close))),
        fill: color,
      });
      const hit = node("rect", {
        x: left + (i * (right - left)) / rows.length,
        y: top,
        width: (right - left) / rows.length,
        height: bottom - top,
        fill: "transparent",
        tabindex: 0,
        role: "button",
        "aria-label": r.trade_date,
      });
      hit.onmouseenter = () => observe(r);
      hit.onfocus = () => observe(r);
      hit.onclick = () => observe(r);
    });
    renderTechnicalMarkers({
      svg: chart,
      rows,
      x,
      y,
      left,
      right,
      top,
      bottom,
      filter,
      onSelect: observe,
      onInspect: observe,
    });
    caption.textContent = `${rows[0].trade_date} ～ ${rows.at(-1).trade_date} · MA5黃／MA20藍／MA60紫`;
  };
  if (artifact.focus_date) {
    const i = all.indexOf(focused);
    offset = Math.max(
      0,
      Math.min(all.length - count, i - Math.floor(count / 2)),
    );
  }
  draw();
  observe(focused);
  const observer = new ResizeObserver(() => {
    if (chart.isConnected) draw();
    else observer.disconnect();
  });
  observer.observe(chart);
  document
    .getElementById("chatArtifactDialog")
    .addEventListener("close", () => observer.disconnect(), { once: true });
}
