import { $, svgNode } from "./dashboard-view.js";
import { state, stockKey } from "../models/stock-model.js";
import { openInsight } from "../controllers/research-controller.js";

export const chipTabs = [
  ["institutional", "法人買賣"],
  ["main-force", "主力進出"],
  ["broker", "券商分點"],
  ["major-holders", "籌碼分布"],
  ["shareholding-distribution", "大戶散戶"],
  ["margin-trading", "融資融券"],
  ["director-holder", "董監持股"],
  ["insider-transactions", "申報轉讓"],
  ["fund-holdings", "ETF／基金持股"],
];
const ui = {
  tab: "institutional",
  page: 0,
  metric: "total",
  large: "400",
  small: "20",
  brokerMode: "range",
  brokerDate: "",
  sort: "buy",
  search: "",
  role: "all",
  method: "all",
  month: "all",
};
const colors = ["#fb657c", "#58bdf7", "#eab95c", "#a993f8"];
let lastStock = "",
  lastRange = "";
const svgText = (text, x, y, attributes = {}) => {
  const label = svgNode("text", { x, y, ...attributes });
  label.textContent = text;
  return label;
};
const format = (v) =>
  v == null || !Number.isFinite(Number(v))
    ? "—"
    : new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 3 }).format(v);
const shareUnit = () => ($("volumeUnit").value === "lots" ? "張" : "股");
const display = (v, unit) =>
  v == null
    ? "—"
    : format(unit === "quantity" ? v / (shareUnit() === "張" ? 1000 : 1) : v);
const node = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};
const select = (label, choices, value, onchange) => {
  const wrapper = node("label", "chip-control", label);
  const el = node("select");
  el.setAttribute("aria-label", label);
  choices.forEach(([v, t]) => {
    const option = node("option", null, t);
    option.value = v;
    el.append(option);
  });
  el.value = value;
  el.onchange = () => {
    onchange(el.value);
    ui.page = 0;
    renderChipWorkspace();
  };
  wrapper.append(el);
  $("chipControls").append(wrapper);
};
const textFilter = (label) => {
  const wrap = node("label", "chip-control", label),
    input = node("input");
  input.placeholder = "名稱／代碼";
  input.value = ui.search;
  input.onchange = () => {
    ui.search = input.value.trim();
    ui.page = 0;
    renderChipWorkspace();
  };
  wrap.append(input);
  $("chipControls").append(wrap);
};
const col = (key, label, unit = "number") => ({
  key,
  label:
    label +
    (unit === "quantity"
      ? `（${shareUnit()}）`
      : unit === "percent"
        ? "（%）"
        : unit === "change"
          ? "（百分點）"
          : ""),
  unit,
});

function tabConfiguration(w) {
  const config = { rows: [], columns: [], series: [], note: "", sources: [] };
  const setMetric = (v) => (ui.metric = v);
  if (ui.tab === "institutional") {
    const choices = [
      ["total", "三大法人合計"],
      ["foreign", "外資"],
      ["trust", "投信"],
      ["dealer", "自營商"],
      ["all", "法人比較"],
    ];
    if (!choices.some((c) => c[0] === ui.metric)) ui.metric = "total";
    select("法人", choices, ui.metric, setMetric);
    config.rows = w.institutions ?? [];
    config.columns = [
      col("date", "日期", "text"),
      col("foreign", "外資", "quantity"),
      col("trust", "投信", "quantity"),
      col("dealer", "自營商", "quantity"),
      col("total", "合計", "quantity"),
    ];
    config.series = (
      ui.metric === "all" ? ["foreign", "trust", "dealer"] : [ui.metric]
    ).map((key, i) => ({
      key,
      label: choices.find((c) => c[0] === key)[1],
      unit: "quantity",
      type: ui.metric === "all" ? "line" : "bar",
      color: colors[i],
    }));
    config.note =
      "每日買進減賣出；上方數字為選定區間已取得交易日合計。合計缺任何法人數值即留空。";
    config.sources = ["TaiwanStockInstitutionalInvestorsBuySell"];
  } else if (ui.tab === "main-force") {
    const choices = [
      ["net", "前15大淨買賣超"],
      ["house_difference", "買賣家數差"],
      ["concentration5", "5日集中度"],
      ["concentration20", "20日集中度"],
    ];
    if (!choices.some((c) => c[0] === ui.metric)) ui.metric = "net";
    select("主力指標", choices, ui.metric, setMetric);
    config.rows = w.main ?? [];
    config.columns = [
      col("date", "日期", "text"),
      col("close", "收盤價"),
      col("net", "前15大淨買賣超", "quantity"),
      col("house_difference", "家數差"),
      col("concentration5", "5日集中", "percent"),
      col("concentration20", "20日集中", "percent"),
    ];
    config.series = [
      {
        key: ui.metric,
        label: choices.find((c) => c[0] === ui.metric)[1],
        unit:
          ui.metric === "net"
            ? "quantity"
            : ui.metric === "house_difference"
              ? "number"
              : "percent",
        type: ui.metric === "net" ? "bar" : "line",
        color: colors[0],
      },
    ];
    config.note = w.definitions?.main;
    config.sources = ["TaiwanStockBrokerDailyConcentration"];
  } else if (ui.tab === "broker") {
    select(
      "統計方式",
      [
        ["range", "選定區間累計"],
        ["day", "單日排行"],
      ],
      ui.brokerMode,
      (v) => (ui.brokerMode = v),
    );
    const dates = [...new Set((w.branches ?? []).map((r) => r.date))]
      .sort()
      .reverse();
    if (!dates.includes(ui.brokerDate)) ui.brokerDate = dates[0] ?? "";
    if (ui.brokerMode === "day")
      select(
        "分點日期",
        dates.map((d) => [d, d]),
        ui.brokerDate,
        (v) => (ui.brokerDate = v),
      );
    select(
      "排行",
      [
        ["buy", "買超最多"],
        ["sell", "賣超最多"],
      ],
      ui.sort,
      (v) => (ui.sort = v),
    );
    textFilter("分點搜尋");
    const grouped = new Map();
    for (const r of w.branches ?? []) {
      if (ui.brokerMode === "day" && r.date !== ui.brokerDate) continue;
      const entry = grouped.get(r.id) ?? {
        id: r.id,
        name: r.name,
        buy: 0,
        sell: 0,
        days: new Set(),
      };
      entry.buy += r.buy;
      entry.sell += r.sell;
      entry.days.add(r.date);
      grouped.set(r.id, entry);
    }
    config.rows = [...grouped.values()]
      .map((r) => ({ ...r, net: r.buy - r.sell, observations: r.days.size }))
      .filter((r) => (r.name + " " + r.id).includes(ui.search))
      .sort((a, b) => (ui.sort === "buy" ? b.net - a.net : a.net - b.net));
    config.columns = [
      col("name", "券商分點", "text"),
      col("buy", "買進", "quantity"),
      col("sell", "賣出", "quantity"),
      col("net", "淨買賣超", "quantity"),
      col("observations", "已取得天數"),
    ];
    config.note =
      "排行只合計已取得的分點日期；點選分點查看每日進出。前15名顯示在排行圖，表格保留全部可用分點。";
    config.sources = ["TaiwanStockTradingDailyReport"];
    config.ranking = true;
  } else if (["major-holders", "shareholding-distribution"].includes(ui.tab)) {
    select(
      "大戶門檻",
      [
        ["400", "逾400張"],
        ["1000", "逾1000張"],
      ],
      ui.large,
      (v) => (ui.large = v),
    );
    if (ui.tab === "shareholding-distribution")
      select(
        "散戶門檻",
        [
          ["20", "20張以下"],
          ["50", "50張以下"],
        ],
        ui.small,
        (v) => (ui.small = v),
      );
    const large = "large" + ui.large,
      small = "small" + ui.small;
    if (ui.tab === "major-holders") {
      config.rows = w.structure ?? [];
      config.columns = [
        col("date", "週資料日", "text"),
        col(large, "大戶持股", "percent"),
        col("foreign", "外資持股", "percent"),
        col("trust", "投信持股", "percent"),
        col("dealer", "自營商持股", "percent"),
        col("director", "董監持股", "percent"),
        col("close", "週收盤價"),
      ];
      config.series = [
        { key: large, label: "大戶持股", unit: "percent", color: colors[0] },
        {
          key: "foreign",
          label: "外資持股",
          unit: "percent",
          color: colors[1],
        },
      ];
      config.note = w.definitions?.structure;
    } else {
      config.rows = w.ownership ?? [];
      config.columns = [
        col("date", "週資料日", "text"),
        col(large, "大戶持股", "percent"),
        col(large + "_change", "大戶較前期", "change"),
        col(small, "散戶持股", "percent"),
        col(small + "_change", "散戶較前期", "change"),
      ];
      config.series = [
        { key: large, label: "大戶持股", unit: "percent", color: colors[0] },
        { key: small, label: "散戶持股", unit: "percent", color: colors[1] },
      ];
      config.note = w.definitions?.ownership;
    }
    config.sources = ["TaiwanStockHoldingSharesPer", "TaiwanStockShareholding"];
  } else if (ui.tab === "margin-trading") {
    const choices = [
      ["margin_balance", "融資餘額"],
      ["short_balance", "融券餘額"],
      ["short_margin_ratio", "券資比"],
    ];
    if (!choices.some((c) => c[0] === ui.metric)) ui.metric = "margin_balance";
    select("資券指標", choices, ui.metric, setMetric);
    config.rows = w.margin ?? [];
    config.columns = [
      col("date", "日期", "text"),
      col("margin_change", "融資增減", "quantity"),
      col("margin_balance", "融資餘額", "quantity"),
      col("margin_usage", "融資使用率", "percent"),
      col("short_change", "融券增減", "quantity"),
      col("short_balance", "融券餘額", "quantity"),
      col("short_usage", "融券使用率", "percent"),
      col("short_margin_ratio", "券資比", "percent"),
      col("offset", "資券互抵", "quantity"),
      col("offset_ratio", "互抵／成交量", "percent"),
      col("close", "收盤價"),
    ];
    config.series = [
      {
        key: ui.metric,
        label: choices.find((c) => c[0] === ui.metric)[1],
        unit: ui.metric === "short_margin_ratio" ? "percent" : "quantity",
        color: colors[0],
      },
    ];
    config.note = w.definitions?.margin;
    config.sources = ["TaiwanStockMarginPurchaseShortSale"];
  } else if (ui.tab === "director-holder") {
    const observations = state.equityData?.director_observations ?? [];
    const months = [...new Set(observations.map((r) => r.period_month))]
      .sort()
      .reverse();
    if (!months.includes(ui.month)) ui.month = months[0] ?? "";
    select(
      "資料月份",
      months.map((m) => [m, m]),
      ui.month,
      (v) => (ui.month = v),
    );
    const rows = observations.filter((r) => r.period_month === ui.month);
    const roles = [...new Set(rows.map((r) => r.role))];
    if (!roles.includes(ui.role)) ui.role = "all";
    select(
      "身分別",
      [["all", "全部身分"], ...roles.map((r) => [r, r])],
      ui.role,
      (v) => (ui.role = v),
    );
    config.rows = rows.filter((r) => ui.role === "all" || r.role === ui.role);
    config.columns = [
      col("role", "身分別", "text"),
      col("name", "姓名／法人", "text"),
      col("holding_shares", "持股", "quantity"),
      col("holding_percent", "持股比例", "percent"),
      col("pledge_shares", "設質", "quantity"),
      col("pledge_percent", "設質比例", "percent"),
      col("period_month", "資料月份", "text"),
    ];
    config.note =
      "官方最新月份揭露；資料月份不等於公告日。原始來源未提供持股占比時留空，法人與代表人不重複合計。點選人別查看已保存歷史。";
    config.sources = ["DirectorHoldingsReport"];
    config.director = true;
  } else if (ui.tab === "insider-transactions") {
    const rows = w.transfers ?? [],
      methods = [...new Set(rows.map((r) => r.method))];
    if (!methods.includes(ui.method)) ui.method = "all";
    select(
      "轉讓方式",
      [["all", "全部方式"], ...methods.map((r) => [r, r])],
      ui.method,
      (v) => (ui.method = v),
    );
    config.rows = rows.filter(
      (r) => ui.method === "all" || r.method === ui.method,
    );
    config.columns = [
      col("date", "揭露日期", "text"),
      col("transfer_shares", "申報轉讓", "quantity"),
      col("name", "申報人", "text"),
      col("role", "身分", "text"),
      col("method", "轉讓方式", "text"),
      col("transfer_period", "有效期間", "text"),
    ];
    config.series = [
      {
        key: "transfer_shares",
        label: "申報轉讓股數",
        unit: "quantity",
        type: "bar",
        color: colors[2],
      },
    ];
    config.note =
      "最新公開轉讓日報逐次保存；揭露日期不冒充申報日，申報不代表已成交，贈與也不代表市場賣出。空白區間不表示從未申報。";
    config.sources = ["InsiderTransfersReport"];
  } else {
    textFilter("ETF／基金搜尋");
    config.rows = (w.funds ?? []).filter((r) =>
      (r.fund_name + " " + r.fund_code).includes(ui.search),
    );
    config.columns = [
      col("fund_name", "基金名稱", "text"),
      col("fund_code", "代碼", "text"),
      col("holding_shares", "持股", "quantity"),
      col("holding_value", "持股金額（元）"),
      col("weight_percent", "占基金權重", "percent"),
      col("weight_change", "較前月末權重", "change"),
      col("date", "揭露日", "text"),
      col("comparison_date", "比較基準日", "text"),
    ];
    config.note =
      "只涵蓋已接入的基金；權重是占該基金資產，不是占公司股本。前月末以前最後一筆揭露作比較，需核對基準日期；點選基金看歷史。";
    config.sources = ["TaiwanStockActiveETFHolding", "FundHoldingsReport"];
    config.funds = true;
  }
  return config;
}

function drawChart(rows, series, ranking = false) {
  const svg = $("chipChart");
  svg.replaceChildren();
  svg.setAttribute("viewBox", "0 0 1000 300");
  const available = series.some((s) => rows.some((r) => r[s.key] != null));
  $("chipChartEmpty").hidden = available;
  svg.hidden = !available;
  if (!available) return;
  const data = ranking
    ? rows.slice(0, 15)
    : [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const values = data
    .flatMap((r) => series.map((s) => r[s.key]))
    .filter((v) => v != null);
  const lo = Math.min(0, ...values),
    hi = Math.max(0, ...values),
    span = hi - lo || 1;
  const x = (i) => 135 + ((i + 0.5) * 785) / data.length,
    y = (v) => 240 - ((v - lo) / span) * 205;
  for (let i = 0; i <= 4; i++) {
    const value = lo + (span * i) / 4;
    svg.append(
      svgNode("line", {
        x1: 135,
        x2: 920,
        y1: y(value),
        y2: y(value),
        stroke: "#293d55",
      }),
      svgText(display(value, series[0].unit), 127, y(value) + 4, {
        "text-anchor": "end",
        fill: "#b8cce3",
        "font-size": 13,
      }),
    );
  }
  series.forEach((s, index) => {
    let path = "",
      connected = false;
    data.forEach((r, i) => {
      const v = r[s.key];
      if (v == null) {
        connected = false;
        return;
      }
      const title = svgNode("title");
      title.textContent = `${r.date ?? r.name} · ${s.label} ${display(v, s.unit)} ${s.unit === "quantity" ? shareUnit() : s.unit === "percent" ? "%" : ""}`;
      if (s.type === "bar") {
        const bar = svgNode("rect", {
          x: x(i) - Math.max(2, Math.min(30, 650 / data.length)) / 2,
          y: Math.min(y(v), y(0)),
          width: Math.max(2, Math.min(30, 650 / data.length)),
          height: Math.max(1, Math.abs(y(v) - y(0))),
          fill: v >= 0 ? "#fb657c" : "#43d6ac",
        });
        bar.append(title);
        svg.append(bar);
      } else {
        path += (connected ? " L" : " M") + x(i) + "," + y(v);
        connected = true;
        const dot = svgNode("circle", {
          cx: x(i),
          cy: y(v),
          r: 3,
          fill: s.color ?? colors[index],
        });
        dot.append(title);
        svg.append(dot);
      }
    });
    if (path)
      svg.append(
        svgNode("path", {
          d: path,
          fill: "none",
          stroke: s.color ?? colors[index],
          "stroke-width": 2,
        }),
      );
  });
  // Close uses its own price scale and never shares the volume / percentage axis.
  const closes = data.map((r) => r.close).filter((v) => v != null);
  if (closes.length && !ranking) {
    const min = Math.min(...closes),
      max = Math.max(...closes),
      height = max - min || 1;
    let path = "",
      connected = false;
    data.forEach((r, i) => {
      if (r.close == null) {
        connected = false;
        return;
      }
      path +=
        (connected ? " L" : " M") +
        x(i) +
        "," +
        (240 - ((r.close - min) / height) * 205);
      connected = true;
    });
    svg.append(
      svgNode("path", {
        d: path,
        fill: "none",
        stroke: "#eab95c",
        "stroke-width": 1.7,
        "stroke-dasharray": "4 3",
      }),
    );
    [min, max].forEach((v) =>
      svg.append(
        svgText(format(v), 928, 240 - ((v - min) / height) * 205 + 4, {
          fill: "#eab95c",
          "font-size": 13,
        }),
      ),
    );
  }
  const ticks = [0, Math.floor((data.length - 1) / 2), data.length - 1];
  [...new Set(ticks)].forEach((i) =>
    svg.append(
      svgText(ranking ? String(i + 1) : data[i].date, x(i), 275, {
        fill: "#b8cce3",
        "font-size": 13,
        "text-anchor": "middle",
      }),
    ),
  );
}

function openRow(row, config, w) {
  let points = [],
    label = "",
    unit = "quantity";
  if (config.ranking) {
    points = (w.branches ?? [])
      .filter((r) => r.id === row.id)
      .map((r) => ({ period: r.date, value: r.net }));
    label = row.name + " 每日淨買賣超";
  }
  if (config.funds) {
    points = (w.fund_history ?? [])
      .filter((r) => r.fund_code === row.fund_code)
      .map((r) => ({ period: r.date, value: r.holding_shares }));
    label = row.fund_name + " 持股";
  }
  if (config.director) {
    points = (state.equityData?.director_observations ?? [])
      .filter((r) => r.name === row.name && r.role === row.role)
      .map((r) => ({ period: r.date, value: r.holding_shares }));
    label = row.name + " 持股";
  }
  if (!label) return;
  openInsight({
    stock: stockKey(),
    label,
    unit: shareUnit(),
    points: points.map((p) => ({
      ...p,
      value:
        p.value == null ? null : p.value / (shareUnit() === "張" ? 1000 : 1),
    })),
    note: config.note,
  });
}

export function renderChipWorkspace() {
  if (!$("chipWorkspace")) return;
  const currentStock = stockKey(),
    currentRange = JSON.stringify(state.range);
  if (currentStock !== lastStock) {
    ui.page = 0;
    ui.search = "";
    ui.role = "all";
    ui.method = "all";
    ui.month = "";
    ui.brokerDate = "";
    lastStock = currentStock;
  }
  if (currentRange !== lastRange) {
    ui.page = 0;
    lastRange = currentRange;
  }
  const data = state.equityData,
    w = data?.workspace ?? {};
  $("chipTabs")
    .querySelectorAll("button")
    .forEach((b) => {
      const selected = b.dataset.chipTab === ui.tab;
      b.classList.toggle("active", selected);
      b.setAttribute("aria-selected", String(selected));
    });
  $("chipControls").replaceChildren();
  const config = tabConfiguration(w);
  $("chipTitle").textContent = chipTabs.find((t) => t[0] === ui.tab)[1];
  $("chipDefinition").textContent = config.note ?? "";
  $("chipUnitNote").textContent =
    `數量單位：${shareUnit()} · 1張＝1,000股；比例不換算。紅色淨買超、綠色淨賣超。`;
  const dates = (config.rows ?? [])
    .map((r) => r.date)
    .filter(Boolean)
    .sort();
  $("chipPeriod").textContent = data
    ? `${config.director ? "截止 " + data.end + " · 揭露月 " + ui.month : data.start + " ～ " + data.end} · ${config.rows.length} 筆觀測${dates.length && !config.director ? " · 最新 " + dates.at(-1) : ""}`
    : "正在載入所選股票…";
  $("chipSummary").replaceChildren();
  config.series.forEach((s) => {
    const values = config.rows.map((r) => r[s.key]).filter((v) => v != null);
    const cumulative =
      ["institutional", "main-force"].includes(ui.tab) &&
      ["total", "foreign", "trust", "dealer", "net"].includes(s.key);
    const value = values.length
      ? cumulative
        ? values.reduce((a, b) => a + b, 0)
        : [...config.rows]
            .sort((a, b) => String(a.date).localeCompare(String(b.date)))
            .filter((r) => r[s.key] != null)
            .at(-1)[s.key]
      : null;
    const card = node("div", "chip-stat");
    card.append(
      node("span", null, s.label + (cumulative ? " · 區間合計" : " · 最新")),
      node(
        "strong",
        value > 0 ? "up" : value < 0 ? "down" : "",
        display(value, s.unit) +
          (value != null
            ? s.unit === "quantity"
              ? " " + shareUnit()
              : s.unit === "percent"
                ? " %"
                : ""
            : ""),
      ),
      node("small", null, `${values.length} 筆有效觀測`),
    );
    $("chipSummary").append(card);
  });
  $("chipChartLegend").replaceChildren();
  config.series.forEach((s, i) => {
    const item = node("span", null, s.label);
    item.style.color = s.color ?? colors[i];
    $("chipChartLegend").append(item);
  });
  if (config.rows.some((r) => r.close != null))
    $("chipChartLegend").append(
      node("span", "chip-price-key", "收盤價 · 右軸"),
    );
  if (config.ranking)
    drawChart(
      config.rows,
      [{ key: "net", label: "分點淨買賣超", unit: "quantity", type: "bar" }],
      true,
    );
  else if (config.funds)
    drawChart(
      config.rows.map((r, i) => ({ ...r, date: r.fund_code })),
      [
        {
          key: "weight_percent",
          label: "基金權重",
          unit: "percent",
          type: "bar",
        },
      ],
    );
  else if (config.director)
    drawChart(
      config.rows.map((r, i) => ({ ...r, date: String(i + 1) })),
      [{ key: "holding_shares", label: "持股", unit: "quantity", type: "bar" }],
    );
  else drawChart(config.rows, config.series);
  $("chipChartEmpty").textContent =
    "此指標尚無可用觀測，請查看下方來源狀態；缺值不表示零。";
  const head = node("tr");
  config.columns.forEach((c) => head.append(node("th", null, c.label)));
  $("chipTableHead").replaceChildren(head);
  const sorted =
    config.ranking || config.funds || config.director
      ? config.rows
      : [...config.rows].sort((a, b) => b.date.localeCompare(a.date));
  const pages = Math.max(1, Math.ceil(sorted.length / 15));
  ui.page = Math.min(ui.page, pages - 1);
  $("chipTableRows").replaceChildren();
  sorted.slice(ui.page * 15, (ui.page + 1) * 15).forEach((row) => {
    const tr = node("tr");
    config.columns.forEach((c, i) => {
      const td = node(
        "td",
        [
          "net",
          "total",
          "foreign",
          "trust",
          "dealer",
          "margin_change",
          "short_change",
        ].includes(c.key)
          ? row[c.key] > 0
            ? "up"
            : row[c.key] < 0
              ? "down"
              : ""
          : "",
        c.unit === "text" ? (row[c.key] ?? "—") : display(row[c.key], c.unit),
      );
      if (i === 0 && (config.ranking || config.funds || config.director)) {
        const button = node("button", "chip-row-action", td.textContent);
        button.onclick = () => openRow(row, config, w);
        td.replaceChildren(button);
      }
      tr.append(td);
    });
    $("chipTableRows").append(tr);
  });
  if (!sorted.length) {
    const tr = node("tr"),
      td = node(
        "td",
        "chip-empty",
        "此區間尚無可用明細。來源缺漏、無事件與零值是不同狀態。",
      );
    td.colSpan = config.columns.length;
    tr.append(td);
    $("chipTableRows").append(tr);
  }
  $("chipPageLabel").textContent =
    `第 ${ui.page + 1}／${pages} 頁 · ${sorted.length} 筆`;
  $("chipPrevPage").disabled = ui.page === 0;
  $("chipNextPage").disabled = ui.page >= pages - 1;
  $("chipExtra").replaceChildren();
  if (["major-holders", "shareholding-distribution"].includes(ui.tab)) {
    const detail = node("details", "chip-sources"),
      summary = node("summary", null, "完整集保持股級距");
    const table = node("table"),
      wrap = node("div", "chip-table-wrap"),
      head = node("tr");
    ["資料日", "持股級距（股）", "人數", "股數", "占集保庫存（%）"].forEach(
      (label) => head.append(node("th", null, label)),
    );
    table.append(head);
    const levels = data?.details?.distribution ?? [],
      latest = levels[0]?.date;
    levels
      .filter((r) => r.date === latest)
      .forEach((r) => {
        const row = node("tr");
        [
          r.date,
          r.HoldingSharesLevel,
          format(r.people),
          format(r.unit),
          format(r.percent),
        ].forEach((value) => row.append(node("td", null, value)));
        table.append(row);
      });
    wrap.append(table);
    detail.append(summary, wrap);
    $("chipExtra").append(detail);
  }
  $("chipCoverage").replaceChildren();
  config.sources.forEach((key) => {
    const source = data?.coverage?.find((r) => r.dataset === key);
    const messages = {
      available: "已取得資料；仍需核對所選區間與筆數",
      requires_token: "需要 FinMind Token 與會員權限",
      not_connected: "來源尚未接入",
      not_configured: "尚未設定追蹤清單",
      no_data: "目前未取得可用資料",
    };
    $("chipCoverage").append(
      node(
        "p",
        null,
        `${source?.label ?? key}：${source ? (messages[source.status] ?? source.status) : "尚未載入"}${source?.received_at ? " · 接收 " + new Date(source.received_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }) : ""}`,
      ),
    );
  });
}

export function initChipWorkspace() {
  $("chipTabs").replaceChildren();
  chipTabs.forEach(([key, label]) => {
    const button = node("button", null, label);
    button.type = "button";
    button.dataset.chipTab = key;
    button.setAttribute("role", "tab");
    button.onclick = () => {
      ui.tab = key;
      ui.page = 0;
      ui.search = "";
      renderChipWorkspace();
    };
    $("chipTabs").append(button);
  });
  $("chipPrevPage").onclick = () => {
    ui.page--;
    renderChipWorkspace();
  };
  $("chipNextPage").onclick = () => {
    ui.page++;
    renderChipWorkspace();
  };
  renderChipWorkspace();
}
