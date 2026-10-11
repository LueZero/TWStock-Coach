import {
  $,
  fmt,
  localTime,
  textCell,
  svgText,
  svgNode,
} from "./dashboard-view.js";
import { state, stockKey } from "./../models/stock-model.js";
import { openInsight } from "./../controllers/research-controller.js";

const researchTones = {
  good: "改善／強勢",
  bad: "衰退",
  watch: "留意",
  neutral: "背景",
  unknown: "缺資料",
};

const researchShareUnit = () =>
  $("volumeUnit").value === "lots" ? "張" : "股";

const researchShareValue = (value) =>
  value == null
    ? null
    : Number(value) / ($("volumeUnit").value === "lots" ? 1000 : 1);

const researchQuantity = (value) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 3 }).format(
        researchShareValue(value),
      );

const researchSignedQuantity = (value) =>
  value == null
    ? "—"
    : (Number(value) > 0 ? "+" : "") + researchQuantity(value);

function researchHoldingLevel(value) {
  const text = String(value || "").replace(/,/g, "");
  if (text === "morethan1000000") return "超過 " + researchQuantity(1000000);
  if (/^\d+-\d+$/.test(text))
    return text.split("-").map(researchQuantity).join("～");
  return text === "total" ? "合計" : text;
}

function researchNumber(value, unit = "") {
  if (value == null) return "—";
  if (unit === "張")
    return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 3 }).format(
      value,
    );
  return ["元", "股"].includes(unit)
    ? new Intl.NumberFormat("zh-TW", {
        notation: "compact",
        maximumFractionDigits: 2,
      }).format(value)
    : fmt(value);
}

function addTrendAction(card, metric, points) {
  card.classList.add("trend-card");
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `${metric.label}：開啟歷史趨勢與判讀依據`);
  const action = document.createElement("span");
  action.className = "trend-action";
  action.textContent = "歷年趨勢與依據 ↗";
  card.append(action);
  const open = () => {
    const coverage = [
      ...(state.financialData?.coverage || []),
      ...(state.equityData?.coverage || []),
    ].filter((s) => metric.datasets?.includes(s.dataset));
    const source = coverage
      .map(
        (s) =>
          `${s.label} · ${s.source || "未接入"} · ${s.received_at ? "接收 " + localTime(s.received_at) + "／修訂 " + s.revision : "尚無接收紀錄"}`,
      )
      .join("；");
    const shares = metric.unit === "股";
    openInsight({
      label: metric.label,
      unit: shares ? researchShareUnit() : metric.unit || "",
      points: shares
        ? points.map((p) => ({ ...p, value: researchShareValue(p.value) }))
        : points,
      assessment: metric.assessment,
      note: (metric.note || "") + (source ? " 來源：" + source : ""),
      period: metric.period,
      stock: stockKey(),
    });
  };
  card.onclick = open;
  card.onkeydown = (event) => {
    if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      open();
    }
  };
}

function researchCard(container, metric, points = []) {
  const card = document.createElement("div");
  card.className =
    "research-card fund-" + (metric.assessment?.tone || "unknown");
  const label = document.createElement("span");
  label.className = "research-label";
  label.textContent = metric.label;
  const unit = metric.unit === "股" ? researchShareUnit() : metric.unit;
  const numeric =
    metric.unit === "股" ? researchShareValue(metric.value) : metric.value;
  const value = document.createElement("strong");
  value.textContent =
    researchNumber(numeric, unit) +
    (metric.value == null ? "" : " " + (unit || ""));
  const badge = document.createElement("span");
  badge.className = "research-verdict";
  badge.textContent = metric.assessment?.label || "資料不足";
  const note = document.createElement("p");
  note.textContent =
    metric.assessment?.reason || metric.note || "尚未取得可驗證資料。";
  const period = document.createElement("small");
  period.textContent = metric.period || "資料期間尚無法確認";
  card.append(label, value, badge, note, period);
  addTrendAction(card, metric, points);
  container.append(card);
}

function emptyMetric(key, label, unit, note) {
  return {
    key,
    label,
    unit,
    value: null,
    period: null,
    note,
    assessment: { tone: "unknown", label: "未取得資料", reason: note },
  };
}

function researchMissingReason(datasets = []) {
  if (!state.equityData)
    return "正在讀取來源狀態；資料尚未載入，不代表持股或交易量為零。";
  return datasets
    .map((key) => {
      const source = state.equityData.coverage.find((s) => s.dataset === key);
      if (!source) return "來源尚未接入。";
      if (source.status === "requires_token")
        return `${source.label}：尚未設定 FINMIND_TOKEN，需要 ${source.entitlement} 權限；免費行情不包含此資料。`;
      if (source.status === "not_configured")
        return `${source.label}：尚未設定 ETF_WATCHLIST，請先指定要追蹤的主動 ETF。`;
      if (source.status === "not_connected")
        return `${source.label}：尚未接入持股揭露來源，需匯入附揭露日期與來源連結的授權資料。`;
      if (source.status === "available")
        return `${source.label}：來源已有資料，但此區間／所選歷史時點沒有可用觀測；週頻資料不一定每天發布，請擴大區間核對。`;
      return `${source.label}：目前未取得可用資料；請檢查所選區間、歷史視角與下方載入結果。`;
    })
    .join(" ");
}

function researchEmptyTable(id, columns, message) {
  const body = $(id);
  if (body.children.length) return;
  const tr = document.createElement("tr"),
    td = document.createElement("td");
  td.colSpan = columns;
  td.className = "research-empty";
  td.textContent = message;
  tr.append(td);
  body.append(tr);
}

function renderCoverage(container, coverage) {
  container.replaceChildren();
  const labels = {
    available: "已取得",
    requires_token: "需要來源權限",
    not_connected: "尚未接入授權來源",
    no_data: "所選期間未取得",
    not_configured: "尚未設定來源",
  };
  coverage.forEach((s) => {
    const item = document.createElement("div");
    item.className = "coverage-item";
    const name = document.createElement("strong");
    name.textContent = s.label;
    const detail = document.createElement("span");
    detail.textContent = `${labels[s.status] || s.status} · ${s.source || "來源尚未接入"}${s.entitlement ? " · " + s.entitlement : ""}${s.received_at ? " · 接收 " + localTime(s.received_at) + " · 修訂 " + s.revision : ""}`;
    item.append(name, detail);
    container.append(item);
  });
}

function safeSourceLink(tr, url, label = "來源 ↗") {
  const cell = document.createElement("td");
  if (typeof url === "string" && /^https:\/\//.test(url)) {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = label;
    cell.append(link);
  } else cell.textContent = "未提供";
  tr.append(cell);
}

function renderBasic() {
  const equity = state.equityData;
  $("companyProfile").replaceChildren();
  const profile = equity?.profile?.profile;
  const companyDate = (value) => {
    const text = String(value || "");
    return /^\d{8}$/.test(text)
      ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}`
      : /^\d{7}$/.test(text)
        ? `${Number(text.slice(0, 3)) + 1911}-${text.slice(3, 5)}-${text.slice(5)}`
        : text || "—";
  };
  const fields = profile
    ? [
        ["公司全名", profile["公司名稱"]],
        ["股票代號", state.stock.symbol],
        [
          "市場",
          state.stock.market === "TWSE" ? "上市・證交所" : "上櫃・櫃買中心",
        ],
        ["產業", state.stock.industry || profile["產業別"]],
        ["成立日期", companyDate(profile["成立日期"])],
        [
          "上市／上櫃日期",
          companyDate(profile["上市日期"] || profile["上櫃日期"]),
        ],
        [
          "實收資本額",
          profile["實收資本額"]
            ? researchNumber(Number(profile["實收資本額"]), "元") + " 元"
            : "—",
        ],
        ["董事長", profile["董事長"]],
        ["公司網站", profile["網址"]],
        ["官方出表日期", companyDate(profile["出表日期"])],
        [
          "公司資料接收時間",
          localTime(
            equity.coverage.find((s) => s.dataset === "CompanyProfile")
              ?.received_at,
          ),
        ],
      ]
    : [
        ["公司名稱", state.stock.name],
        ["股票代號", state.stock.symbol],
        ["市場", state.stock.market],
        ["目前目錄產業", state.stock.industry],
        [
          "公司揭露資料",
          "尚未取得官方公司基本資料；目前名稱與產業來自股票目錄。",
        ],
      ];
  fields.forEach(([label, value]) => {
    const item = document.createElement("div"),
      name = document.createElement("span"),
      text = document.createElement("strong");
    name.textContent = label;
    text.textContent = value || "—";
    item.append(name, text);
    $("companyProfile").append(item);
  });
  const targets = equity?.targets,
    reports = targets?.reports || [];
  $("targetMetrics").replaceChildren();
  researchCard(
    $("targetMetrics"),
    {
      key: "targets",
      label: "有效機構目標價中位數",
      value: targets?.median ?? null,
      unit: "元",
      period: reports
        .map((r) => r.date)
        .sort()
        .at(-1),
      datasets: ["AnalystTargetReport"],
      note:
        targets?.note ||
        "尚無可驗證機構報告來源；不以技術線型推估數字冒充法人目標。",
      assessment: {
        tone: "neutral",
        label: reports.length
          ? `${reports.length} 家有效機構`
          : "授權來源未接入",
        reason: reports.length
          ? `機構區間 ${fmt(targets.low)}～${fmt(targets.high)} 元；同機構只取最新，過180天報告不加入摘要。`
          : "需要機構、報告日期、TWD目標價及可追溯報告連結。",
      },
    },
    targets?.history || [],
  );
  $("targetNote").textContent =
    targets?.note || "來源尚未接入；目前不提供法人目標價。";
  $("targetRows").replaceChildren();
  reports.forEach((r) => {
    const tr = document.createElement("tr");
    [r.institution, r.date, fmt(r.target_price)].forEach((v) =>
      textCell(tr, v),
    );
    safeSourceLink(tr, r.source_url);
    $("targetRows").append(tr);
  });
}

function renderBranches() {
  let rows = (state.equityData?.details.branches || []).filter((r) =>
    (r.name + " " + r.id).includes($("branchSearch").value.trim()),
  );
  rows = rows
    .slice()
    .sort((a, b) =>
      $("branchSort").value === "sell" ? a.net - b.net : b.net - a.net,
    );
  $("branchRows").replaceChildren();
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    [
      r.name,
      researchQuantity(r.buy),
      researchQuantity(r.sell),
      researchSignedQuantity(r.net),
      r.date,
    ].forEach((v) => textCell(tr, v));
    $("branchRows").append(tr);
  });
  researchEmptyTable(
    "branchRows",
    5,
    state.equityData?.details.branches?.length
      ? "沒有符合搜尋條件的分點；請清除搜尋文字。"
      : researchMissingReason(["TaiwanStockTradingDailyReport"]),
  );
}

function renderChips() {
  const data = state.equityData;
  $("chipUnitNote").textContent =
    `數量顯示：${researchShareUnit()} · 1張=1,000股，零股保留小數；占比及基金權重不換算。`;
  $("institutionUnitHint").textContent =
    `卡片為區間合計；彈窗為每日值 · ${researchShareUnit()}`;
  document.querySelectorAll("#chipPanel th").forEach((th) => {
    if (/（股）|（張）/.test(th.textContent))
      th.textContent = th.textContent.replace(
        /（股）|（張）/,
        "（" + researchShareUnit() + "）",
      );
  });
  const groups = [
    ["institutionMetrics", ["foreign", "trust", "dealer"]],
    ["brokerMetrics", ["main_net", "branches"]],
    [
      "distributionMetrics",
      ["large_holders", "small_holders", "foreign_holding"],
    ],
  ];
  const names = {
    foreign: ["外資淨買賣超", "股"],
    trust: ["投信淨買賣超", "股"],
    dealer: ["自營商淨買賣超", "股"],
    main_net: ["前15大分點淨流向", "股"],
    branches: ["可查詢券商分點數", "個"],
    large_holders: ["逾400張持股占比", "%"],
    small_holders: ["5張以下持股占比", "%"],
    foreign_holding: ["外資持股比率", "%"],
  };
  const sources = {
    foreign: ["TaiwanStockInstitutionalInvestorsBuySell"],
    trust: ["TaiwanStockInstitutionalInvestorsBuySell"],
    dealer: ["TaiwanStockInstitutionalInvestorsBuySell"],
    main_net: ["TaiwanStockBrokerDailyConcentration"],
    branches: ["TaiwanStockTradingDailyReport"],
    large_holders: ["TaiwanStockHoldingSharesPer"],
    small_holders: ["TaiwanStockHoldingSharesPer"],
    foreign_holding: ["TaiwanStockShareholding"],
  };
  groups.forEach(([id, keys]) => {
    $(id).replaceChildren();
    keys.forEach((key) => {
      let metric = data?.metrics.find((m) => m.key === key) || {
        ...emptyMetric(key, ...names[key], "資料尚未載入。"),
        datasets: sources[key],
      };
      if (metric.value == null)
        metric = {
          ...metric,
          assessment: {
            tone: "unknown",
            label: "未取得資料",
            reason: researchMissingReason(metric.datasets),
          },
        };
      researchCard($(id), metric, data?.history[key] || []);
    });
  });
  const flows = (data?.metrics || []).filter(
    (m) => ["foreign", "trust", "dealer"].includes(m.key) && m.value != null,
  );
  $("chipSummary").textContent = flows.length
    ? flows
        .map(
          (m) =>
            `${m.label} ${researchSignedQuantity(m.value)} ${researchShareUnit()}（資料至 ${m.period}）`,
        )
        .join("；") +
      "。1張=1,000股；零股保留小數。這是區間已取得盤後流量，不是買入指令；請核對明細天數與缺漏。"
    : "先等資料，再做判讀：沒有法人數字、分點或持股分級時，不顯示主力正在進場等結論。";
  $("institutionRows").replaceChildren();
  (data?.details.institutions || []).forEach((r) => {
    const tr = document.createElement("tr");
    [
      r.date,
      researchSignedQuantity(r.foreign),
      researchSignedQuantity(r.trust),
      researchSignedQuantity(r.dealer),
    ].forEach((v) => textCell(tr, v));
    $("institutionRows").append(tr);
  });
  renderBranches();
  $("distributionRows").replaceChildren();
  const levels = data?.details.distribution || [],
    day = levels[0]?.date;
  levels
    .filter((r) => r.date === day)
    .forEach((r) => {
      const tr = document.createElement("tr");
      [
        r.date,
        researchHoldingLevel(r.HoldingSharesLevel),
        fmt(r.people),
        fmt(r.percent),
        researchQuantity(r.unit),
      ].forEach((v) => textCell(tr, v));
      $("distributionRows").append(tr);
    });
  researchEmptyTable(
    "distributionRows",
    5,
    researchMissingReason(["TaiwanStockHoldingSharesPer"]),
  );
  const funds = data?.fund_holdings || [];
  $("fundMetrics").replaceChildren();
  const knownFunds = new Set(),
    fundPoints = [];
  const fundHistory = (data?.fund_history || [])
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const day of [...new Set(fundHistory.map((r) => r.date))]) {
    fundHistory
      .filter((r) => r.date === day)
      .forEach((r) => knownFunds.add(r.fund_code));
    fundPoints.push({ period: day, value: knownFunds.size });
  }
  researchCard(
    $("fundMetrics"),
    {
      key: "funds",
      label: "已取得持股揭露的基金數",
      value: funds.length || null,
      unit: "檔",
      period: funds
        .map((r) => r.date)
        .sort()
        .at(-1),
      datasets: ["TaiwanStockActiveETFHolding", "FundHoldingsReport"],
      note: "只涵蓋匯入來源與 ETF_WATCHLIST 指定主動ETF。基金權重不可跨基金相加，持股變化可能來自申購贖回，不等於經理人主動買進。",
      assessment: {
        tone: funds.length ? "neutral" : "unknown",
        label: funds.length ? "部分覆蓋" : "尚無持股來源",
        reason: funds.length
          ? "有持股不表示基金看好未來價格；先看揭露日與同一基金的歷史變化。"
          : researchMissingReason([
              "TaiwanStockActiveETFHolding",
              "FundHoldingsReport",
            ]),
      },
    },
    fundPoints,
  );
  $("fundNote").textContent = funds.length
    ? "目前只顯示已接入揭露的最新持股；被動ETF及共同基金需各自授權來源。每檔基金可查看股數趨勢。"
    : "來源未接入，不能解讀成沒有任何 ETF／基金持有這檔股票；主動 ETF 另需設定 ETF_WATCHLIST。";
  $("fundRows").replaceChildren();
  funds.forEach((r) => {
    const tr = document.createElement("tr");
    [
      `${r.fund_name} ${r.fund_code}`,
      r.date,
      researchQuantity(r.holding_shares),
      fmt(r.weight_percent),
    ].forEach((v) => textCell(tr, v));
    const cell = document.createElement("td"),
      button = document.createElement("button");
    button.className = "quiet";
    button.textContent = "查看趨勢 ↗";
    button.onclick = () =>
      openInsight({
        stock: stockKey(),
        label: `${r.fund_name} 持有 ${state.stock.symbol}`,
        unit: researchShareUnit(),
        note:
          "同一基金揭露的持股；1張=1000股。申購贖回也會改變持股。來源：" +
          r.source_url,
        points: (data.fund_history || [])
          .filter((p) => p.fund_code === r.fund_code)
          .map((p) => ({
            period: p.date,
            value: researchShareValue(p.holding_shares),
          })),
      });
    cell.append(button);
    tr.append(cell);
    $("fundRows").append(tr);
  });
  researchEmptyTable(
    "fundRows",
    5,
    researchMissingReason([
      "TaiwanStockActiveETFHolding",
      "FundHoldingsReport",
    ]),
  );
  renderCoverage($("chipCoverage"), data?.coverage || []);
}

function periodDate(period) {
  return period.length === 7 ? period + "-01" : period;
}

function renderInsight() {
  const insight = state.insight;
  if (!insight) return;
  $("insightTitle").textContent = insight.label;
  $("insightContext").textContent =
    `${state.stock.name} ${state.stock.symbol} · ${insight.unit} · ${$("financialMode").value === "historical" ? "所選K線當時可得" : "最新取得修訂"}`;
  $("insightAssessment").className =
    "insight-assessment fund-" + (insight.assessment?.tone || "neutral");
  $("insightAssessment").textContent =
    (insight.assessment?.label ? insight.assessment.label + "：" : "") +
    (insight.assessment?.reason || insight.note);
  $("insightNote").textContent =
    insight.note +
    " 趨勢使用已取得修訂；歷史期間不等於當時已公告。缺資料不補點，折線只連接已取得數值。";
  const start = $("insightStart").value,
    end = $("insightEnd").value;
  const points = insight.points
    .filter(
      (p) =>
        p.value != null &&
        Number.isFinite(Number(p.value)) &&
        periodDate(p.period) >= start &&
        periodDate(p.period) <= end,
    )
    .sort((a, b) => a.period.localeCompare(b.period));
  const svg = $("insightChart"),
    width = Math.max(260, svg.getBoundingClientRect().width || 900),
    height = 340;
  const valueText = (value) =>
    insight.unit === "張"
      ? new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 3 }).format(
          value,
        )
      : fmt(value);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.replaceChildren();
  $("insightRows").replaceChildren();
  $("insightValueHeading").textContent =
    insight.label + "（" + insight.unit + "）";
  points
    .slice()
    .reverse()
    .forEach((p) => {
      const tr = document.createElement("tr");
      textCell(tr, p.period);
      textCell(tr, valueText(p.value));
      $("insightRows").append(tr);
    });
  if (start > end) {
    $("insightStatus").textContent = "起始日期不可晚於截止日期。";
    return;
  }
  $("insightStatus").textContent = points.length
    ? `${points[0].period} 至 ${points.at(-1).period} · ${points.length} 筆實際資料 · 日期區間 ${start} 至 ${end}`
    : "所選區間無已取得資料。請調整日期、更新來源，或查看權限與缺漏；不是數值為零。";
  if (!points.length) {
    svgText(svg, "此區間無可用資料", width / 2, 150, {
      "text-anchor": "middle",
    });
    return;
  }
  const left = 75,
    right = width - 18,
    top = 25,
    bottom = 290;
  let low = Math.min(...points.map((p) => p.value)),
    high = Math.max(...points.map((p) => p.value));
  const bars = $("insightChartType").value === "bar";
  if (bars) {
    low = Math.min(0, low);
    high = Math.max(0, high);
  }
  const pad = (high - low) * 0.1 || Math.max(Math.abs(high) * 0.1, 1);
  low -= pad;
  high += pad;
  const first = Date.parse(periodDate(points[0].period)),
    last = Date.parse(periodDate(points.at(-1).period));
  const x = (p) =>
    first === last
      ? (left + right) / 2
      : left +
        ((Date.parse(periodDate(p.period)) - first) / (last - first)) *
          (right - left);
  const y = (v) => bottom - ((v - low) / (high - low)) * (bottom - top);
  for (let i = 0; i <= 4; i++) {
    const value = low + ((high - low) * i) / 4,
      Y = y(value);
    svg.append(
      svgNode("line", {
        x1: left,
        x2: right,
        y1: Y,
        y2: Y,
        stroke: "#294459",
        "stroke-dasharray": "3 5",
      }),
    );
    svgText(
      svg,
      new Intl.NumberFormat("zh-TW", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value),
      left - 10,
      Y + 4,
      { "text-anchor": "end" },
    );
  }
  if (bars)
    points.forEach((p) =>
      svg.append(
        svgNode("rect", {
          x: x(p) - 2,
          y: Math.min(y(0), y(p.value)),
          width: Math.max(
            1,
            Math.min(12, ((right - left) / points.length) * 0.6),
          ),
          height: Math.max(1, Math.abs(y(0) - y(p.value))),
          fill: p.value >= 0 ? "#ff8596" : "#4ed6b1",
        }),
      ),
    );
  else
    svg.append(
      svgNode("path", {
        d: points
          .map((p, i) => (i ? "L" : "M") + x(p) + "," + y(p.value))
          .join(" "),
        fill: "none",
        stroke: "#6adaeb",
        "stroke-width": 2,
      }),
    );
  points.forEach((p) => {
    const dot = svgNode("circle", {
        cx: x(p),
        cy: y(p.value),
        r: points.length > 100 ? 2 : 3,
        fill: "#88e9f1",
      }),
      title = svgNode("title");
    title.textContent = `${p.period}：${valueText(p.value)} ${insight.unit}`;
    dot.append(title);
    svg.append(dot);
  });
  [
    points[0],
    ...(width > 500 && points.length > 2
      ? [points[Math.floor(points.length / 2)]]
      : []),
    ...(points.length > 1 ? [points.at(-1)] : []),
  ].forEach((p, i) =>
    svgText(svg, p.period, x(p), 320, {
      "text-anchor":
        points.length === 1
          ? "middle"
          : i === 0
            ? "start"
            : p === points.at(-1)
              ? "end"
              : "middle",
    }),
  );
}

export function initResearchView() {}

export {
  researchTones,
  researchShareUnit,
  researchShareValue,
  researchQuantity,
  researchSignedQuantity,
  researchHoldingLevel,
  researchNumber,
  addTrendAction,
  researchCard,
  emptyMetric,
  researchMissingReason,
  researchEmptyTable,
  renderCoverage,
  safeSourceLink,
  renderBasic,
  renderBranches,
  renderChips,
  periodDate,
  renderInsight,
};
