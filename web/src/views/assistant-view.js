import {
  renderTechnicalMarkers,
  signalCategories,
} from "./technical-markers.js";
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
  ma10: "10日均線",
  ma20: "20日均線",
  ma60: "60日均線",
  ma120: "120日均線",
  ma240: "240日均線",
  rsi14: "RSI14",
  macd_histogram: "MACD柱狀值",
  macd: "MACD快慢線差",
  macd_signal: "MACD訊號線",
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
export function readableAnswer(text, evidence = []) {
  const ids = new Set(evidence.map((e) => e.id));
  return String(text).replace(/\[([^\[\]]+)\]/g, (match, refs) =>
    refs.split(/[、,，]\s*/).every((id) => ids.has(id.trim())) ? "" : match,
  );
}
function explain(target, text, evidence) {
  for (const paragraph of readableAnswer(text, evidence).split(/\n\s*\n/)) {
    const [heading, ...lines] = paragraph.split("\n");
    if (lines.length && heading.length <= 24) {
      target.append(
        element("h4", heading),
        element("p", lines.join("\n"), "assistant-summary-text"),
      );
    } else target.append(element("p", paragraph, "assistant-summary-text"));
  }
}
function renderResearchCards(target, ai, evidence, actions) {
  const nav = element("nav", null, "assistant-report-nav");
  nav.setAttribute("aria-label", "報告快速導覽");
  const jump = (selector) => {
    const card = target.querySelector(selector);
    if (card)
      target.scrollTo({
        top:
          target.scrollTop +
          card.getBoundingClientRect().top -
          target.getBoundingClientRect().top -
          nav.offsetHeight -
          12,
        behavior: "smooth",
      });
  };
  nav.append(button("下一步", () => jump(".assistant-action-grid")));
  for (const [id, label] of [
    ["technical", "走勢"],
    ["basic", "公司"],
    ["financial", "財務"],
    ["chips", "籌碼"],
    ["peers", "同業"],
    ["news", "新聞"],
    ["market", "大盤"],
  ])
    nav.append(button(label, () => jump(`[data-research-section="${id}"]`)));
  target.append(nav);
  if (ai.analysis_windows?.length) {
    const windows = element("details", null, "assistant-report-windows");
    windows.append(
      element("summary", `實際查詢期間 · ${ai.analysis_windows.length} 個範圍`),
    );
    for (const w of ai.analysis_windows)
      windows.append(element("span", `${w.start} ～ ${w.end} · ${w.purpose}`));
    target.append(windows);
  }
  if (ai.action_plan?.length) {
    target.append(element("h3", "你可以怎麼做", "assistant-section-heading"));
    const plans = element("div", null, "assistant-action-grid");
    const labels = {
      entry: "還沒買：先等什麼",
      holding: "已持有：如何觀察",
      exit: "想退出：何時重評估",
    };
    const planTabs = element("div", null, "assistant-action-tabs");
    planTabs.setAttribute("aria-label", "選擇想了解的持有情況");
    const showPlan = (id) => {
      for (const card of plans.children)
        card.hidden = card.dataset.action !== id;
      for (const control of planTabs.children)
        control.setAttribute(
          "aria-pressed",
          String(control.dataset.action === id),
        );
    };
    for (const plan of ai.action_plan) {
      const card = element("article", null, "assistant-action-card " + plan.id);
      card.dataset.action = plan.id;
      const control = button(
        { entry: "還沒買", holding: "持有中", exit: "退出觀察" }[plan.id],
        () => showPlan(plan.id),
      );
      control.dataset.action = plan.id;
      planTabs.append(control);
      card.append(element("h4", labels[plan.id]));
      for (const [label, key] of [
        ["先看條件", "condition"],
        ["下一步", "action"],
        ["看法失效時", "invalidation"],
      ]) {
        const field = element("div", null, "assistant-report-field");
        field.append(
          element("span", label),
          element("p", readableAnswer(plan[key], evidence)),
        );
        card.append(field);
      }
      card.append(
        button("查看判斷依據", () => actions.evidence(plan.evidence_ids)),
      );
      plans.append(card);
    }
    showPlan("entry");
    target.append(planTabs, plans);
  }
  if (ai.sections?.length) {
    target.append(element("h3", "為什麼這樣判斷", "assistant-section-heading"));
    const cards = element("div", null, "assistant-research-grid");
    const labels = {
      technical: "技術走勢",
      basic: "公司與產業",
      financial: "財務與估值",
      chips: "籌碼動向",
      peers: "同業比較",
      news: "新聞與討論",
      market: "大盤環境",
    };
    for (const [index, section] of ai.sections.entries()) {
      const card = element("article", null, "assistant-research-card");
      card.dataset.researchSection = section.id;
      card.append(
        element(
          "span",
          `${String(index + 1).padStart(2, "0")} · ${labels[section.id]}`,
          "assistant-card-kicker",
        ),
        element("h4", section.title),
        element(
          "p",
          readableAnswer(section.takeaway, evidence),
          "assistant-card-takeaway",
        ),
      );
      for (const [label, key] of [
        ["資料怎麼說", "reason"],
        ["接下來看什麼", "watch"],
      ]) {
        const field = element("div", null, "assistant-report-field");
        field.append(
          element("span", label),
          element("p", readableAnswer(section[key], evidence)),
        );
        card.append(field);
      }
      card.append(
        button("查看資料來源", () => actions.evidence(section.evidence_ids)),
      );
      cards.append(card);
    }
    target.append(cards);
  }
  if (ai.cautions?.length) {
    const limits = element("aside", null, "assistant-report-limits");
    limits.append(element("h4", "這次判斷有哪些限制"));
    const list = element("ul");
    for (const caution of ai.cautions)
      list.append(element("li", readableAnswer(caution, evidence)));
    limits.append(list);
    target.append(limits);
  }
}
export function renderMessages(messages = [], evidence = []) {
  const target = $("assistantMessages");
  target.replaceChildren();
  for (const m of messages) {
    const bubble = element("div", null, `assistant-bubble ${m.role}`);
    bubble.append(
      element("small", m.role === "user" ? "你" : "看盤助手 · 依查詢時點分析"),
      element(
        "div",
        readableAnswer(m.content.answer || m.content.text || "", evidence),
      ),
    );
    target.append(bubble);
  }
  target.scrollTop = target.scrollHeight;
}
export function renderAssistantReport(report, tab, actions) {
  const stopped = [
    "failed",
    "cancelled",
    "interrupted",
    "unavailable",
  ].includes(actions.run?.status);
  const pending = stopped
    ? `本次分析未完成：${actions.run.error || "執行已停止"}。可重新產生報告；尚無通過驗證的AI結論。`
    : "正在整理資料與產生AI摘要，完成後顯示分析結論。";
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
    `${report.meta.mode === "historical" ? "當時可得資料" : "報告建立時資料"} · 日K／原始價格 · 行情 ${report.meta.data_date || "不足"} · 截止 ${new Date(report.meta.as_of).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })} · ${report.ai ? "AI解讀完成" : stopped ? "AI分析未完成" : "等待AI分析"}`;
  if (tab === "summary") {
    const hero = element("article", null, "assistant-report-hero");
    hero.append(
      element("span", "AI 研究報告 · 先看結論", "assistant-card-kicker"),
      element("h3", "AI 重點摘要"),
    );
    explain(
      hero,
      report.ai?.summary ||
        (report.ai
          ? "此舊版報告未單獨產生AI摘要，請閱讀下方AI解讀。"
          : pending),
      report.evidence,
    );
    target.append(hero);
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
    const inputManifest = report.ai?.input_manifest || report.input_manifest;
    if (inputManifest?.length) {
      const submitted = element("details", null, "assistant-facet-details");
      submitted.append(element("summary", "查看已提交給AI的資料"));
      const states = {
        included: "已送入",
        partial: "部分資料已送入",
        missing: "缺資料／不足",
        failed: "查詢失敗",
      };
      for (const m of inputManifest)
        submitted.append(
          element(
            "p",
            `${m.label}：${states[m.status] || m.status}${m.bar_count == null ? "" : ` · ${m.bar_count} 根完成日K`}${m.note ? ` · ${m.note}` : ""}`,
          ),
        );
      downloads.append(submitted);
    }
    if (report.ai?.sections?.length)
      renderResearchCards(target, report.ai, report.evidence, actions);
    target.append(
      element(
        "h3",
        report.ai?.sections?.length
          ? "回答你的問題"
          : report.ai
            ? "AI 完整報告"
            : "AI 報告",
        "assistant-section-heading",
      ),
    );
    if (report.ai?.analysis_scope)
      target.append(
        element(
          "p",
          `本次工具查詢截止 ${new Date(report.ai.analysis_scope.as_of).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })} · ${report.ai.tool_evidence_ids?.length || 0} 筆查詢證據；圖表與程式條件保留建立報告時的版本。`,
          "assistant-muted",
        ),
      );
    explain(
      target,
      report.ai?.answer ||
        (stopped
          ? "分析已停止，尚無通過驗證的AI報告。請重新產生報告或送出追問。"
          : "AI尚未完成，這裡不以程式摘要代替分析結論。"),
      report.evidence,
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
    target.append(downloads, details);
  } else if (tab === "plan") {
    if (report.observations?.length) {
      target.append(element("h3", "看懂技術狀態"));
      const observations = element("div", null, "assistant-observations");
      for (const observation of report.observations) {
        const item = element("article", null, "assistant-observation");
        item.append(
          element(
            "strong",
            observation.label,
            "assistant-tone " + observation.state,
          ),
          element("p", observation.note),
          button("查看指標依據", () =>
            actions.evidence(observation.evidence_ids),
          ),
        );
        observations.append(item);
      }
      target.append(observations);
    }
    target.append(
      element("h3", report.holding ? "持倉與進出場觀察" : "技術進出場觀察條件"),
    );
    if (report.plan_checks?.length) {
      target.append(
        element(
          "p",
          "下列是固定突破策略的條件檢核，與整體股票分析分開；缺一項不代表所有面向都沒有結論。",
          "subtle",
        ),
      );
      for (const check of report.plan_checks) {
        const item = element("div", null, "assistant-quality");
        item.append(
          element(
            "strong",
            `${check.passed ? "✓ 已符合" : "○ 待符合"} · ${check.label}`,
          ),
          element("p", check.detail),
        );
        target.append(item);
      }
    }
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
        ...(s.max_shares != null
          ? [
              element(
                "p",
                `成本後報酬風險比 ${money(s.net_reward_risk)} · 資金／風險可容納 ${money(s.max_shares)} 股（${money(s.max_shares / 1000)}張） · 失效價估算損失 ${money(s.risk_at_stop)} 元`,
              ),
            ]
          : []),
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
        if (e.rows || e.data) {
          const details = element("details");
          details.append(
            element("summary", "查看來源明細"),
            element("pre", JSON.stringify(e.rows || e.data, null, 2)),
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
    const readout = element(
      "p",
      "將游標移到日K，查看當日均線結構及技術事件。點選可設定歷史分析日。",
      "assistant-chart-readout",
    );
    const signalSelect = element("select");
    signalSelect.setAttribute("aria-label", "報告技術訊號分類");
    signalSelect.dataset.reportSignals = "true";
    for (const [value, label] of signalCategories) {
      const option = element("option", label);
      option.value = value;
      signalSelect.append(option);
    }
    signalSelect.onchange = () => draw();
    tools.append(signalSelect);
    const signalDetails = element("details", null, "assistant-facet-details");
    const signalSummary = element("summary", "查看此K棒的訊號依據");
    const signalBody = element("div");
    signalDetails.append(signalSummary, signalBody);
    signalDetails.hidden = true;
    const eventsForRow = (r) =>
      (report.chart_annotations || []).filter((m) =>
        m.timestamp ? m.timestamp === r.timestamp : m.date === r.trade_date,
      );
    const observe = (r) => {
      const events = eventsForRow(r);
      readout.textContent = `${r.trade_date} · 開 ${money(r.open)}／高 ${money(r.high)}／低 ${money(r.low)}／收 ${money(r.close)} · ${r.technical_state?.label || r.technical_label || "舊報告未保存逐日技術標記"}${events.length ? " · " + events.map((e) => e.label).join("、") : " · 當日無新技術事件"}`;
      signalDetails.hidden = !events.length;
      signalBody.replaceChildren();
      for (const event of events)
        signalBody.append(element("p", `${event.label}：${event.note}`));
    };
    target.append(
      tools,
      svg,
      readout,
      signalDetails,
      element(
        "p",
        `實線：黃色MA5、藍色MA20、紫色MA60。虛線：候選觸發／失效／目標。紅▲偏多、綠▼偏空；文字自動避讓，同日多筆顯示+數量。點標記看依據，點K線可設定歷史分析日。${report.technical_event_version ? `規則 ${report.technical_event_version}。` : "舊報告保留當時已保存事件，未補推新訊號。"}`,
        "subtle",
      ),
      button("回個股看盤工作台", () => actions.dashboard(report)),
    );
    if (report.observations?.length) {
      const latest = element("div", null, "assistant-chart-tools");
      for (const observation of report.observations.filter((o) =>
        ["short_trend", "alignment", "macd", "kd"].includes(o.id),
      ))
        latest.append(
          element(
            "span",
            `${observation.date} ${observation.label}`,
            "assistant-tone " + observation.state,
          ),
        );
      target.append(latest);
    }
    if (report.chart_annotations?.length) {
      const events = element("details", null, "assistant-facet-details");
      events.append(
        element("summary", "展開完成日K的技術事件（標記不等於買賣點）"),
      );
      for (const mark of [...report.chart_annotations].reverse())
        events.append(
          element("p", `${mark.date} · ${mark.label}：${mark.note}`),
        );
      target.append(events);
    }
    const draw = () => {
      svg.replaceChildren();
      const data = report.chart_bars.slice(
        graph.offset,
        graph.offset + graph.count,
      );
      caption.textContent = `${data[0].trade_date}～${data.at(-1).trade_date} · ${data.length} 根`;
      observe(data.at(-1));
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
        averages = data
          .flatMap((r) => [r.ma5, r.ma20, r.ma60])
          .filter((v) => v != null),
        min = Math.min(...data.map((r) => r.low), ...levels, ...averages),
        max = Math.max(...data.map((r) => r.high), ...levels, ...averages),
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
          "aria-label":
            r.trade_date +
            " 收盤 " +
            money(r.close) +
            " " +
            (r.technical_label || ""),
        });
        hit.onmouseenter = () => observe(r);
        hit.onfocus = () => observe(r);
        hit.onclick = () => {
          observe(r);
          actions.bar(r);
        };
        hit.onkeydown = (e) => {
          if (e.key === "Enter") actions.bar(r);
        };
      });
      for (const [key, color] of [
        ["ma5", "#eac36f"],
        ["ma20", "#73d3ed"],
        ["ma60", "#d09de6"],
      ]) {
        let path = "",
          connected = false;
        data.forEach((r, i) => {
          if (r[key] != null) {
            path += (connected ? "L" : "M") + x(i) + "," + y(r[key]) + " ";
            connected = true;
          } else connected = false;
        });
        node("path", {
          d: path,
          stroke: color,
          fill: "none",
          "stroke-width": 1.4,
          "pointer-events": "none",
        });
      }
      renderTechnicalMarkers({
        svg,
        rows: data,
        x,
        y,
        left,
        right,
        top,
        bottom,
        eventsForRow,
        filter: signalSelect.value,
        onInspect: observe,
        onSelect: () => {
          signalDetails.open = true;
        },
      });
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
