const $ = (id) => document.getElementById(id);
export const element = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
const money = (n) =>
  n == null
    ? "—"
    : Number(n).toLocaleString("zh-TW", { maximumFractionDigits: 2 });
const names = {
  support: "支持",
  oppose: "需留意",
  neutral: "需綜合判斷",
  missing: "資料不足",
};
const technicalNames = {
  ma5: "5日均線",
  ma20: "20日均線",
  ma60: "60日均線",
  ma240: "240日均線",
  rsi14: "RSI14",
  macd_histogram: "MACD柱狀值",
  volume_ratio: "相對前20日量比",
  atr14: "ATR14波動幅度",
  k: "KD K值",
  d: "KD D值",
  bb_upper: "布林上緣",
  bb_lower: "布林下緣",
  prior_high20: "前20日最高價",
};
function button(text, action) {
  const b = element("button", text, "quiet");
  b.type = "button";
  b.onclick = action;
  return b;
}
let graph = { report: null, count: 60, offset: 0 };
export function renderMessages(messages = []) {
  const target = $("assistantMessages");
  target.replaceChildren();
  for (const m of messages) {
    const bubble = element("div", null, `assistant-bubble ${m.role}`);
    bubble.append(
      element("small", m.role === "user" ? "你" : "看盤助手 · 固定本報告資料"),
      element("div", m.content.answer || m.content.text || ""),
    );
    target.append(bubble);
  }
  target.scrollTop = target.scrollHeight;
}
export function renderAssistantReport(report, tab, actions) {
  document
    .querySelectorAll("[data-report-tab]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.reportTab === tab)),
    );
  const target = $("assistantContent");
  target.replaceChildren();
  if (!report) {
    const welcome = element("div", null, "assistant-welcome");
    welcome.append(
      element("span", "✦"),
      element("h3", "看懂依據，再判斷時機"),
      element("p", "選取股票後產生報告，先看資料是否足夠，再觀察進出場條件。"),
    );
    target.append(welcome);
    return;
  }
  $("assistantMeta").textContent =
    `${report.meta.mode === "historical" ? "當時可得資料" : "最新資料包"} · 日K／原始價格 · 行情 ${report.meta.data_date || "不足"} · 截止 ${new Date(report.meta.as_of).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })} · ${report.ai ? "AI解讀完成" : "平台條件報告"}`;
  if (tab === "summary") {
    target.append(
      element(
        "div",
        report.status_label,
        "assistant-summary-state " + report.status,
      ),
    );
    for (const text of report.summary)
      target.append(element("p", text, "assistant-summary-text"));
    const downloads = element("div", null, "assistant-chart-tools");
    for (const [format, label] of [
      ["md", "下載Markdown報告"],
      ["json", "下載JSON資料"],
    ]) {
      const a = element("a", label, "quiet");
      a.href = `/api/assistant/reports/${report.id}/download?format=${format}`;
      a.setAttribute("download", "");
      downloads.append(a);
    }
    target.append(downloads);
    const facets = element("div", null, "assistant-facets");
    for (const f of report.facets) {
      const item = element("div", null, "assistant-facet");
      item.append(
        element("strong", f.label),
        element("span", names[f.state], "assistant-tone " + f.state),
        element("p", f.note),
      );
      facets.append(item);
    }
    const details = element("details", null, "assistant-facet-details");
    details.append(element("summary", "展開七個面向的資料狀態"), facets);
    target.append(element("h3", report.ai ? "AI 白話解讀" : "AI 解讀"));
    target.append(
      element(
        "p",
        report.ai?.answer || "AI尚未完成；上方是平台條件計算，不是模型建議。",
        "assistant-summary-text",
      ),
    );
    if (report.ai)
      for (const h of report.ai.highlights) {
        const item = element("div", null, "assistant-quality");
        item.append(
          element("p", h.text),
          button("查看依據", () => actions.evidence(h.evidence_ids)),
        );
        target.append(item);
      }
    target.append(button("查看進出場條件", () => actions.tab("plan")));
    target.append(details);
  } else if (tab === "plan") {
    target.append(
      element(
        "h3",
        report.holding ? "持倉與進出場觀察" : "未持有：進場候選條件",
      ),
    );
    if (report.holding) {
      target.append(
        element(
          "p",
          `成本 ${money(report.holding.cost)} 元 · 持有 ${money(report.holding.shares)} 股 · 未實現毛損益 ${money(report.holding.unrealized_gross)} 元`,
          "assistant-summary-text",
        ),
        element(
          "p",
          report.holding.exit_condition,
          "assistant-quality warning",
        ),
        element("p", report.holding.note, "subtle"),
      );
    }
    if (!report.scenarios.length)
      target.append(
        element(
          "p",
          "目前沒有可用的精確價位計畫。先檢查資料品質與趨勢，不以空白或零元當買賣價。",
          "assistant-quality warning",
        ),
      );
    for (const s of report.scenarios) {
      const item = element("div", null, "assistant-scenario");
      item.append(
        element("h3", s.label),
        element(
          "p",
          `${s.valid_until < new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date()) ? "參考期限已過，請重新產生報告" : s.enabled ? (s.confirmed ? "歷史收盤技術條件已確認；不是現在成交價" : "候選觀察，尚未確認") : "情境停用"} · 參考期限 ${s.valid_until}`,
        ),
      );
      const prices = element("div", null, "assistant-prices");
      for (const [label, key] of [
        ["觀察觸發價", "trigger"],
        ["失效參考價", "stop"],
        ["2R參考目標", "target"],
      ]) {
        const cell = element("div");
        cell.append(element("span", label), element("strong", money(s[key])));
        prices.append(cell);
      }
      item.append(prices);
      for (const condition of s.conditions)
        item.append(element("p", condition));
      item.append(
        element("p", s.invalidation, "assistant-quality warning"),
        element(
          "p",
          `成本後報酬風險比 ${money(s.net_reward_risk)} · 資金／風險可容納 ${money(s.max_shares)} 股（${money(s.max_shares / 1000)}張） · 失效價估算損失 ${money(s.risk_at_stop)} 元`,
        ),
        element("p", s.note, "subtle"),
        button("在K線查看條件", () => actions.tab("chart")),
      );
      target.append(item);
    }
  } else if (tab === "evidence") {
    target.append(element("h3", "指標、來源與分析證據"));
    const filters = element("div", null, "assistant-chart-tools");
    for (const [value, label] of [
      ["all", "全部"],
      ["technical", "技術"],
      ["financial", "財務"],
      ["chips", "籌碼"],
      ["market", "大盤"],
      ["peers", "同業"],
      ["news", "新聞"],
    ])
      filters.append(button(label, () => drawEvidence(value)));
    target.append(filters);
    const list = element("div");
    target.append(list);
    const drawEvidence = (category) => {
      list.replaceChildren();
      for (const e of report.evidence.filter(
        (e) => category === "all" || e.category === category,
      )) {
        const item = element("article", null, "assistant-evidence");
        item.id = "assistant-evidence-" + e.id.replaceAll(":", "-");
        item.append(element("h4", technicalNames[e.label] || e.label));
        if (e.value != null)
          item.append(element("strong", `${money(e.value)} ${e.unit || ""}`));
        item.append(
          element(
            "p",
            [
              e.date,
              e.source_time,
              e.received_at ? "接收 " + e.received_at : null,
            ]
              .filter(Boolean)
              .join(" · "),
          ),
        );
        if (e.note) item.append(element("p", e.note));
        if (e.rows) {
          const details = element("details");
          details.append(
            element("summary", "查看來源明細"),
            element("pre", JSON.stringify(e.rows, null, 2)),
          );
          item.append(details);
        }
        if (e.source) {
          const d = element("details");
          d.append(
            element("summary", "來源與修訂"),
            element(
              "pre",
              JSON.stringify(
                { source: e.source, revisions: e.revisions },
                null,
                2,
              ),
            ),
          );
          item.append(d);
        }
        if (e.url) {
          try {
            const u = new URL(e.url);
            if (u.protocol === "https:") {
              const link = element("a", "開啟原文 ↗");
              link.href = u.href;
              link.target = "_blank";
              link.rel = "noopener noreferrer";
              item.append(link);
            }
          } catch {}
        }
        list.append(item);
      }
      if (!list.childElementCount)
        list.append(
          element("p", "此類資料尚未取得。", "assistant-quality warning"),
        );
    };
    drawEvidence("all");
  } else if (tab === "quality") {
    target.append(
      element("h3", "資料可得性與限制"),
      element(
        "p",
        `資料包 ${report.snapshot_id} · 規則 ${report.version}`,
        "subtle",
      ),
    );
    for (const q of report.quality)
      target.append(element("div", q.label, "assistant-quality " + q.severity));
    for (const text of [...report.limitations, ...(report.ai?.cautions || [])])
      target.append(element("div", text, "assistant-quality"));
  } else if (tab === "chart") {
    if (!report.chart_bars.length) {
      target.append(
        element("p", "没有可繪製的完成日K。", "assistant-quality warning"),
      );
      return;
    }
    if (graph.report !== report.id)
      graph = {
        report: report.id,
        count: Math.min(60, report.chart_bars.length),
        offset: Math.max(0, report.chart_bars.length - 60),
      };
    const tools = element("div", null, "assistant-chart-tools"),
      caption = element("span");
    const change = (count, offset) => {
      graph.count = Math.min(report.chart_bars.length, Math.max(10, count));
      graph.offset = Math.max(
        0,
        Math.min(offset, report.chart_bars.length - graph.count),
      );
      draw();
    };
    tools.append(
      button("←", () =>
        change(graph.count, graph.offset - Math.ceil(graph.count / 3)),
      ),
      button("→", () =>
        change(graph.count, graph.offset + Math.ceil(graph.count / 3)),
      ),
      button("放大", () =>
        change(
          Math.round(graph.count * 0.7),
          graph.offset + Math.round(graph.count * 0.3),
        ),
      ),
      button("縮小", () => change(Math.round(graph.count * 1.4), graph.offset)),
      button("重設", () =>
        change(
          Math.min(60, report.chart_bars.length),
          report.chart_bars.length - 60,
        ),
      ),
      caption,
    );
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("assistant-chart");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "報告原始價格日K與進出場候選區域");
    target.append(
      tools,
      svg,
      element(
        "p",
        "黃色虛線：候選觸發價；綠色虛線：失效價；紫色：參考目標。線是未來觀察區域，不是已發生買點。點選K線可建立該日當時可得報告。",
        "subtle",
      ),
      button("回個股看盤工作台", () => actions.dashboard(report)),
    );
    const draw = () => {
      svg.replaceChildren();
      const data = report.chart_bars.slice(
        graph.offset,
        graph.offset + graph.count,
      );
      caption.textContent = `${data[0].trade_date}～${data.at(-1).trade_date} · ${data.length} 根`;
      const width = Math.max(200, svg.getBoundingClientRect().width),
        height = svg.getBoundingClientRect().height || 350,
        left = 12,
        right = width - 65,
        top = 24,
        bottom = height - 42;
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      const levels = report.scenarios.flatMap((s) => [
          s.trigger,
          s.stop,
          s.target,
        ]),
        min = Math.min(...data.map((r) => r.low), ...levels),
        max = Math.max(...data.map((r) => r.high), ...levels),
        spread = Math.max(max - min, max * 0.01),
        low = min - spread * 0.08,
        high = max + spread * 0.08;
      const x = (i) => left + ((i + 0.5) * (right - left)) / data.length,
        y = (p) => top + ((high - p) / (high - low)) * (bottom - top);
      const node = (tag, attrs, text) => {
        const e = document.createElementNS(svg.namespaceURI, tag);
        for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
        if (text != null) e.textContent = text;
        svg.append(e);
        return e;
      };
      for (let i = 0; i <= 4; i++) {
        const price = low + ((high - low) * i) / 4;
        node("line", {
          x1: left,
          x2: right,
          y1: y(price),
          y2: y(price),
          stroke: "#21374b",
        });
        node(
          "text",
          { x: right + 6, y: y(price) + 4, fill: "#a3bed1", "font-size": 12 },
          money(price),
        );
      }
      data.forEach((r, i) => {
        const color = r.close >= r.open ? "#f27b8c" : "#53c9a2";
        node("line", {
          x1: x(i),
          x2: x(i),
          y1: y(r.high),
          y2: y(r.low),
          stroke: color,
        });
        node("rect", {
          x: x(i) - Math.max(1, ((right - left) / data.length) * 0.28),
          y: Math.min(y(r.open), y(r.close)),
          width: Math.max(2, ((right - left) / data.length) * 0.56),
          height: Math.max(1, Math.abs(y(r.open) - y(r.close))),
          fill: color,
        });
        const hit = node("rect", {
          x: left + (i * (right - left)) / data.length,
          y: top,
          width: (right - left) / data.length,
          height: bottom - top,
          fill: "transparent",
          tabindex: 0,
          role: "button",
          "aria-label": r.trade_date + " 收盤 " + money(r.close),
        });
        hit.onclick = () => actions.bar(r);
        hit.onkeydown = (e) => {
          if (e.key === "Enter") actions.bar(r);
        };
      });
      for (const [key, color] of [
        ["ma20", "#73d3ed"],
        ["ma60", "#d09de6"],
      ]) {
        let path = "";
        data.forEach((r, i) => {
          if (r[key] != null)
            path += (path ? "L" : "M") + x(i) + "," + y(r[key]) + " ";
        });
        node("path", {
          d: path,
          stroke: color,
          fill: "none",
          "stroke-width": 1.4,
          "pointer-events": "none",
        });
      }
      for (const s of report.scenarios)
        for (const [key, color] of [
          ["trigger", "#eac36f"],
          ["stop", "#63cfa7"],
          ["target", "#c098e6"],
        ]) {
          node("line", {
            x1: left,
            x2: right,
            y1: y(s[key]),
            y2: y(s[key]),
            stroke: color,
            "stroke-dasharray": "6 4",
            "pointer-events": "none",
          });
          node(
            "text",
            {
              x: left + 4,
              y: y(s[key]) - 5,
              fill: color,
              "font-size": 12,
              "pointer-events": "none",
            },
            (key === "trigger"
              ? "候選觸發"
              : key === "stop"
                ? "失效參考"
                : "參考目標") +
              " " +
              money(s[key]),
          );
        }
      node(
        "text",
        { x: left, y: height - 15, fill: "#a3bed1", "font-size": 12 },
        data[0].trade_date,
      );
      node(
        "text",
        {
          x: right,
          y: height - 15,
          fill: "#a3bed1",
          "font-size": 12,
          "text-anchor": "end",
        },
        data.at(-1).trade_date,
      );
    };
    draw();
    svg.onwheel = (e) => {
      e.preventDefault();
      change(
        Math.round(graph.count * (e.deltaY < 0 ? 0.8 : 1.25)),
        graph.offset,
      );
    };
  }
}
