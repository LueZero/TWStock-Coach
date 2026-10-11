import {
  financialCategory,
  financialPages,
  financialTrendPreferences,
  financialChartState,
} from "./financial-view.js";
import { stockKey } from "./../models/stock-model.js";
import { periodDate } from "./research-view.js";
import { svgNode, svgText } from "./dashboard-view.js";

function financialLinePath(points, periods, x, y) {
  const byPeriod = new Map(points.map((p) => [p.period, p]));
  let connected = false;
  return periods
    .map((period) => {
      const point = byPeriod.get(period);
      if (!point) {
        connected = false;
        return "";
      }
      const segment = (connected ? "L" : "M") + x(point) + "," + y(point);
      connected = true;
      return segment;
    })
    .join(" ");
}

function financialPeriodLabel(period) {
  return financialCategory !== "valuation" &&
    /^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)
    ? `${period.slice(0, 4)} Q${Number(period.slice(5, 7)) / 3}`
    : period;
}

function renderFinancialHistory(data, metrics, container) {
  const series = metrics.map((metric, index) => ({
    metric,
    index,
    points: (data.history?.[metric.key] || [])
      .filter((p) => p.value != null && Number.isFinite(p.value))
      .sort((a, b) => a.period.localeCompare(b.period)),
  }));
  const available = series.filter((s) => s.points.length);
  if (!available.length) return;
  const preferenceKey = `${stockKey()}:${financialPages[financialCategory]}`,
    preference = financialTrendPreferences.get(preferenceKey);
  const enabled = new Set(
    preference?.enabled || series.map((s) => s.metric.key),
  );
  const section = document.createElement("section");
  section.className = "financial-history";
  const heading = document.createElement("h4");
  heading.textContent = "指標比較圖與歷史數值";
  section.append(heading);
  const tools = document.createElement("div");
  tools.className = "financial-history-tools";
  const focus = document.createElement("select");
  focus.setAttribute("aria-label", "財務趨勢指標");
  [
    ["all", "全部指標一起比較"],
    ...available.map((s) => [s.metric.key, s.metric.label]),
  ].forEach(([value, label]) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    focus.append(o);
  });
  focus.value = preference?.focus || "all";
  if (!focus.value) focus.value = "all";
  const start = document.createElement("input"),
    end = document.createElement("input");
  start.type = end.type = "date";
  start.setAttribute("aria-label", "財務趨勢起始日期");
  end.setAttribute("aria-label", "財務趨勢截止日期");
  const amount = document.createElement("select");
  amount.setAttribute("aria-label", "財務金額單位");
  [
    ["1000", "千元"],
    ["1", "元"],
    ["100000000", "億元"],
  ].forEach(([v, l]) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = l;
    amount.append(o);
  });
  amount.value = preference?.amount || "1000";
  const labelled = (text, input) => {
    const label = document.createElement("label");
    label.textContent = text;
    label.append(input);
    return label;
  };
  const all = document.createElement("button");
  all.className = "quiet";
  all.textContent = "全部歷史";
  tools.append(
    labelled("比較內容", focus),
    labelled("起始", start),
    labelled("截止", end),
  );
  if (metrics.some((m) => m.unit === "元"))
    tools.append(labelled("金額單位", amount));
  tools.append(all);
  section.append(tools);
  const legend = document.createElement("div");
  legend.className = "financial-series-legend";
  const colors = [
    "#78d6ee",
    "#bfa5ff",
    "#efc172",
    "#f89fc2",
    "#a2cc8a",
    "#b9d4f0",
    "#faab79",
    "#83cebc",
  ];
  const checkboxes = new Map();
  series.forEach((s) => {
    const label = document.createElement("label"),
      checkbox = document.createElement("input"),
      swatch = document.createElement("span");
    checkbox.type = "checkbox";
    checkbox.checked = enabled.has(s.metric.key);
    checkbox.disabled = !s.points.length;
    checkbox.dataset.financialSeries = s.metric.key;
    swatch.style.backgroundColor = colors[s.index % colors.length];
    swatch.className = "financial-series-swatch";
    label.append(
      checkbox,
      swatch,
      document.createTextNode(
        s.metric.label + (s.points.length ? "" : "（缺資料）"),
      ),
    );
    legend.append(label);
    checkboxes.set(s.metric.key, checkbox);
  });
  section.append(legend);
  const status = document.createElement("p");
  status.className = "utility-note";
  status.setAttribute("role", "status");
  const plots = document.createElement("div");
  plots.className = "financial-plots";
  section.append(status, plots);
  const tableSection = document.createElement("section");
  tableSection.className = "financial-period-table";
  const tableHeading = document.createElement("h4");
  tableHeading.textContent = "同期間數值表";
  const controls = document.createElement("div");
  controls.className = "financial-table-controls";
  const count = document.createElement("select");
  count.setAttribute("aria-label", "財務比較期數");
  [4, 8, 12, 0].forEach((n) => {
    const o = document.createElement("option");
    o.value = n;
    o.textContent = n ? `近 ${n} 期` : "區間全部";
    count.append(o);
  });
  count.value = preference?.count || "4";
  const earlier = document.createElement("button"),
    later = document.createElement("button");
  earlier.className = later.className = "quiet";
  earlier.textContent = "← 較早期間";
  later.textContent = "較近期間 →";
  const tableStatus = document.createElement("span");
  controls.append(count, earlier, tableStatus, later);
  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  tableSection.append(tableHeading, controls, scroll);
  section.append(tableSection);
  container.append(section);
  let tableEnd = null;
  const unit = (m) =>
    m.unit === "元" ? amount.selectedOptions[0].textContent : m.unit;
  const value = (m, v) => (m.unit === "元" ? v / Number(amount.value) : v);
  const number = (m, v) =>
    v == null
      ? "—"
      : new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(
          value(m, v),
        );
  const filtered = (s) =>
    s.points.filter(
      (p) =>
        periodDate(p.period) >= start.value &&
        periodDate(p.period) <= end.value,
    );
  const draw = () => {
    const active = series.filter(
      (s) =>
        enabled.has(s.metric.key) &&
        (focus.value === "all" || focus.value === s.metric.key),
    );
    const periods = [
      ...new Set(available.flatMap((s) => filtered(s).map((p) => p.period))),
    ].sort();
    financialTrendPreferences.set(preferenceKey, {
      start: start.value,
      end: end.value,
      focus: focus.value,
      enabled: [...enabled],
      amount: amount.value,
      count: count.value,
    });
    plots.replaceChildren();
    scroll.replaceChildren();
    const invalid = start.value > end.value;
    status.textContent = invalid
      ? "起始日期不可晚於截止日期。"
      : periods.length
        ? `${financialPeriodLabel(periods[0])}～${financialPeriodLabel(periods.at(-1))} · ${periods.length} 個資料期間 · 不同單位分圖，缺值不補零`
        : "此區間無已取得資料。";
    const groups = new Map();
    active
      .filter((s) => filtered(s).length)
      .forEach((s) => {
        const key = unit(s.metric);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(s);
      });
    if (!invalid)
      for (const [groupUnit, entries] of groups) {
        const panel = document.createElement("div");
        panel.className = "financial-chart-panel";
        const title = document.createElement("div");
        title.className = "financial-chart-heading";
        title.textContent = `${entries.map((s) => s.metric.label).join(" ／ ")}（${groupUnit}）`;
        const plot = document.createElement("div");
        plot.className = "financial-inline-plot";
        const svg = svgNode("svg", {
          role: "img",
          "aria-label": title.textContent,
        });
        plot.append(svg);
        panel.append(title, plot);
        plots.append(panel);
        const width = Math.max(260, plots.clientWidth || 760),
          height = entries.length > 1 ? 270 : 240;
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        const pts = entries.flatMap((s) =>
          filtered(s).map((p) => ({ ...p, value: value(s.metric, p.value) })),
        );
        let low = Math.min(...pts.map((p) => p.value)),
          high = Math.max(...pts.map((p) => p.value));
        const pad = (high - low) * 0.1 || Math.max(Math.abs(high) * 0.1, 1);
        low -= pad;
        high += pad;
        const left = 65,
          right = width - 18,
          top = 20,
          bottom = height - 45,
          first = Date.parse(periodDate(periods[0])),
          last = Date.parse(periodDate(periods.at(-1)));
        const x = (p) =>
            first === last
              ? (left + right) / 2
              : left +
                ((Date.parse(periodDate(p.period)) - first) / (last - first)) *
                  (right - left),
          y = (v) => bottom - ((v - low) / (high - low)) * (bottom - top);
        for (let i = 0; i <= 4; i++) {
          const v = low + ((high - low) * i) / 4;
          svg.append(
            svgNode("line", {
              x1: left,
              x2: right,
              y1: y(v),
              y2: y(v),
              stroke: "#294459",
              "stroke-dasharray": "3 5",
            }),
          );
          svgText(
            svg,
            new Intl.NumberFormat("zh-TW", {
              notation: "compact",
              maximumFractionDigits: 1,
            }).format(v),
            left - 10,
            y(v) + 4,
            { "text-anchor": "end" },
          );
        }
        entries.forEach((s) => {
          const points = filtered(s),
            color = colors[s.index % colors.length];
          svg.append(
            svgNode("path", {
              d: financialLinePath(points, periods, x, (p) =>
                y(value(s.metric, p.value)),
              ),
              fill: "none",
              stroke: color,
              "stroke-width": 2,
              "data-financial-line": s.metric.key,
            }),
          );
          points.forEach((p) => {
            const dot = svgNode("circle", {
                cx: x(p),
                cy: y(value(s.metric, p.value)),
                r: points.length > 100 ? 2 : 3,
                fill: color,
              }),
              tooltip = svgNode("title");
            tooltip.textContent = `${financialPeriodLabel(p.period)} · ${s.metric.label}：${number(s.metric, p.value)} ${groupUnit}`;
            dot.append(tooltip);
            svg.append(dot);
          });
        });
        svgText(svg, financialPeriodLabel(periods[0]), left, height - 14);
        if (periods.length > 1)
          svgText(
            svg,
            financialPeriodLabel(periods.at(-1)),
            right,
            height - 14,
            { "text-anchor": "end" },
          );
      }
    if (!groups.size || invalid) {
      const message = document.createElement("p");
      message.className = "research-empty";
      message.textContent = invalid
        ? "日期區間無效。"
        : "請勾選有資料的指標；未取得的項目不畫成零值。";
      plots.append(message);
    }
    const n = Number(count.value) || periods.length;
    tableEnd = Math.max(
      Math.min(tableEnd ?? periods.length, periods.length),
      Math.min(n, periods.length),
    );
    const displayed = invalid
      ? []
      : periods.slice(Math.max(0, tableEnd - n), tableEnd);
    earlier.disabled = tableEnd <= n;
    later.disabled = tableEnd >= periods.length;
    tableStatus.textContent = displayed.length
      ? `${financialPeriodLabel(displayed[0])}～${financialPeriodLabel(displayed.at(-1))}`
      : "無資料期間";
    const table = document.createElement("table");
    table.className = "history-table utility-table financial-comparison-table";
    const head = document.createElement("thead"),
      tr = document.createElement("tr");
    ["指標／單位", ...displayed.map(financialPeriodLabel)].forEach((text) => {
      const th = document.createElement("th");
      th.textContent = text;
      tr.append(th);
    });
    head.append(tr);
    table.append(head);
    const body = document.createElement("tbody");
    active.forEach((s) => {
      const row = document.createElement("tr");
      row.dataset.financialRow = s.metric.key;
      const name = document.createElement("th");
      name.scope = "row";
      name.textContent = `${s.metric.label}（${unit(s.metric)}）`;
      row.append(name);
      displayed.forEach((period) => {
        const cell = document.createElement("td"),
          point = s.points.find((p) => p.period === period);
        cell.textContent = number(s.metric, point?.value);
        if (point) {
          const prior = s.points.find(
            (p) =>
              p.period ===
              String(Number(period.slice(0, 4)) - 1) + period.slice(4),
          );
          const growth = /_yoy$|^revenue_mom$|^contract_qoq$/.test(
            s.metric.key,
          );
          const margin = /margin$/.test(s.metric.key);
          if (growth)
            cell.className =
              point.value > 0
                ? "financial-cell-good"
                : point.value < 0
                  ? "financial-cell-bad"
                  : "";
          else if (margin && prior)
            cell.className =
              point.value > prior.value
                ? "financial-cell-good"
                : point.value < prior.value
                  ? "financial-cell-bad"
                  : "";
          cell.title = `${s.metric.note || ""}${prior ? " 去年同期 " + number(s.metric, prior.value) + " " + unit(s.metric) : ""}`;
        }
        row.append(cell);
      });
      body.append(row);
    });
    table.append(body);
    scroll.append(table);
  };
  const reset = () => {
    const periods = available
      .flatMap((s) => s.points.map((p) => p.period))
      .sort();
    start.value = periodDate(periods[0]);
    end.value = periodDate(periods.at(-1));
    tableEnd = null;
    draw();
  };
  start.onchange = end.onchange = () => {
    tableEnd = null;
    draw();
  };
  focus.onchange = amount.onchange = draw;
  count.onchange = () => {
    tableEnd = null;
    draw();
  };
  all.onclick = reset;
  checkboxes.forEach(
    (checkbox, key) =>
      (checkbox.onchange = () => {
        if (checkbox.checked) enabled.add(key);
        else enabled.delete(key);
        draw();
      }),
  );
  earlier.onclick = () => {
    tableEnd -= Number(count.value) || 1;
    draw();
  };
  later.onclick = () => {
    tableEnd += Number(count.value) || 1;
    draw();
  };
  if (preference) {
    start.value = preference.start;
    end.value = preference.end;
    draw();
  } else reset();
  if (typeof ResizeObserver !== "undefined") {
    financialChartState.observer = new ResizeObserver(() => {
      const width = section.clientWidth;
      if (section.dataset.plotWidth !== String(width)) {
        section.dataset.plotWidth = width;
        draw();
      }
    });
    financialChartState.observer.observe(section);
  }
}

export function initFinancialChart() {}

export { financialLinePath, financialPeriodLabel, renderFinancialHistory };
