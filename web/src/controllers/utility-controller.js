import { postOptions } from "./analysis-controller.js";
import {
  $,
  textCell,
  localTime,
  periodLabel,
} from "./../views/dashboard-view.js";
import {
  state,
  stockKey,
  taipeiDay,
  analysisBar,
  analysisJson,
} from "./../models/stock-model.js";

let utilityStock = "",
  calcVersion = 0,
  calcTimer,
  peerVersion = 0,
  peerBusy = false,
  peerData = null,
  peerList = [],
  peerMetric = "per",
  peerLoadVersion = 0,
  peerSearchVersion = 0;

const peerAutoAttempted = new Set();

let peerPage = 0,
  calcChosenChange = null,
  calcChosenTicks = null;

const utilityMoney = (value) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("zh-TW", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(value);

function calcAdjacentPrice(price, direction, asset) {
  let cents = Math.round(Number(price) * 100);
  if (!Number.isFinite(cents) || cents < 1 || cents > 100000000) return null;
  const tick = (n) =>
    asset === "etf" || asset === "bond_etf"
      ? n < 5000
        ? 1
        : 5
      : asset === "custom"
        ? 1
        : n < 1000
          ? 1
          : n < 5000
            ? 5
            : n < 10000
              ? 10
              : n < 50000
                ? 50
                : n < 100000
                  ? 100
                  : 500;
  const next =
    direction > 0
      ? (Math.floor(cents / tick(cents)) + 1) * tick(cents)
      : Math.floor((cents - 1) / tick(cents - 1)) * tick(cents - 1);
  return next >= 1 && next <= 100000000 ? (next / 100).toFixed(2) : null;
}

const utilityPost = async (url, body) => {
  const response = await fetch(url, postOptions(body)),
    data = await response.json();
  if (!response.ok)
    throw Error(
      typeof data.detail === "string"
        ? data.detail
        : data.detail?.[0]?.msg || "請檢查輸入值",
    );
  return data;
};

function utilityText(container, tag, text, className = "") {
  const el = document.createElement(tag);
  el.textContent = text;
  el.className = className;
  container.append(el);
  return el;
}

function utilitiesChanged() {
  $("calculatorStock").textContent =
    `${state.stock.name} ${state.stock.symbol}`;
  if (utilityStock !== stockKey()) {
    utilityStock = stockKey();
    calcVersion++;
    peerVersion++;
    peerLoadVersion++;
    peerSearchVersion++;
    peerBusy = false;
    peerData = null;
    peerList = [];
    peerPage = 0;
    calcChosenChange = null;
    $("peerFilter").value = "";
    $("peerScope").value = "all";
    $("calcBuyPrice").value = $("calcSellPrice").value = "";
    $("calcPriceNote").textContent = "切換股票後清除價格，避免沿用上一檔。";
    $("calcScenarioRows").replaceChildren();
    $("calcResults").replaceChildren();
    $("calcLegs").replaceChildren();
    $("calcBreakEven").textContent = $("calcNotes").textContent = "";
    $("calcStatus").textContent = "輸入交易價格開始試算。";
    $("calcAsset").value = state.stock.symbol.startsWith("00")
      ? "etf"
      : "stock";
    $("peerSummary").replaceChildren();
    $("peerChart").replaceChildren();
    $("peerRows").replaceChildren();
    $("peerSelection").replaceChildren();
    $("peerSources").replaceChildren();
    $("peerSuggestions").replaceChildren();
    $("peerLoadStatus").textContent = "";
    $("loadPeers").disabled = false;
    calcChosenTicks = null;
    $("calcCloseTicks").value = "";
    $("calcTickNote").textContent = "";
    calcSettings(true);
  }
  if ($("dashboardGrid").dataset.view === "peers" && !peerData && !peerBusy)
    refreshPeers();
}

function calcSettings(resetTax = false) {
  const mode = $("calcMode").value,
    asset = $("calcAsset").value,
    day = $("calcDate").value;
  const pair = !["buy", "sell"].includes(mode),
    dayTrade = mode.startsWith("day_"),
    short = mode === "day_short";
  $("calcRatioControls").hidden = !pair;
  $("calcScenarios").hidden = !pair;
  const ticks = $("calcScenarioMode").value === "ticks";
  ["calcSteps", "calcScenarioMode"].forEach((id) => {
    $(id).disabled = !pair;
  });
  ["calcUpStep", "calcDownStep"].forEach((id) => {
    $(id).disabled = !pair || ticks;
    $(id + "Label").hidden = ticks;
  });
  $("calcTickStepLabel").hidden = !ticks;
  $("calcTickStep").disabled = !pair || !ticks;
  const autoClose =
    dayTrade && (ticks ? calcChosenTicks !== null : calcChosenChange !== null);
  $("calcBuyLabel").hidden = mode === "sell";
  $("calcSellLabel").hidden = mode === "buy";
  $("calcBuyPrice").required = mode !== "sell" && !(autoClose && short);
  $("calcBuyPrice").disabled = mode === "sell";
  $("calcSellPrice").required = mode !== "buy" && !(autoClose && !short);
  $("calcSellPrice").disabled = mode === "buy";
  $("calcCloseTicksLabel").hidden = !dayTrade || !ticks;
  $("calcCloseTicks").disabled = !dayTrade || !ticks;
  $("calcBuyPrice").readOnly = $("calcSellPrice").readOnly = false;
  $("calcRatioNote").textContent = pair
    ? ticks
      ? "當沖可直接填買進、賣出價格；也可填漲跌檔數或點情境列，自動換算另一筆價格。先買後賣以買價為基準，先賣後買以賣價為基準；負檔數表示股價下跌。"
      : "上漲與下跌各自設定百分比，每格以同一進場價計算；也可直接修改買進／賣出價試算。"
    : "";
  let tax =
    asset === "stock"
      ? mode.startsWith("day_") && day >= "2017-04-28" && day <= "2027-12-31"
        ? ".15"
        : ".3"
      : asset === "etf"
        ? ".1"
        : asset === "bond_etf"
          ? day >= "2017-01-01" && day <= "2026-12-31"
            ? "0"
            : ".1"
          : "";
  $("calcTaxNote").textContent =
    `自動套用賣出交易稅 ${tax}%；手續費與稅金元以下採捨去，以券商實際帳單為準。` +
    (asset === "stock" && mode.startsWith("day_")
      ? "須符合現股當沖條件，且當日完成沖銷。"
      : "");
}

async function runCalculator() {
  const version = ++calcVersion,
    key = stockKey(),
    form = $("calculatorForm");
  $("calcScenarioRows").replaceChildren();
  $("calcResults").replaceChildren();
  $("calcLegs").replaceChildren();
  $("calcBreakEven").textContent = $("calcNotes").textContent = "";
  $("calcTickNote").textContent = "";
  if (!form.checkValidity()) {
    $("calcStatus").textContent =
      "請填入有效交易價格、數量與費率（價格最多兩位小數）。";
    return;
  }
  const mode = $("calcMode").value,
    quantity = Number($("calcQuantity").value),
    unit = $("calcUnit").value;
  if (
    mode.startsWith("day_") &&
    (unit === "shares" ? quantity : quantity * 1000) % 1000
  ) {
    $("calcStatus").textContent =
      "零股不適用現股當沖；請用整張數量，或改成一般買賣試算。";
    return;
  }
  const request = {
    mode,
    asset: $("calcAsset").value,
    trade_date: $("calcDate").value,
    quantity,
    unit,
    buy_price: mode === "sell" ? null : $("calcBuyPrice").value || null,
    sell_price: mode === "buy" ? null : $("calcSellPrice").value || null,
    close_change_percent:
      mode.startsWith("day_") && $("calcScenarioMode").value === "percent"
        ? calcChosenChange
        : null,
    close_tick_change:
      mode.startsWith("day_") && $("calcScenarioMode").value === "ticks"
        ? calcChosenTicks
        : null,
    scenario_mode: $("calcScenarioMode").value,
    scenario_tick_step: Number($("calcTickStep").value),
    scenario_up_step:
      $("calcScenarioMode").value === "ticks" || ["buy", "sell"].includes(mode)
        ? 1
        : $("calcUpStep").value,
    scenario_down_step:
      $("calcScenarioMode").value === "ticks" || ["buy", "sell"].includes(mode)
        ? 1
        : $("calcDownStep").value,
    scenario_steps: ["buy", "sell"].includes(mode)
      ? 5
      : Number($("calcSteps").value),
    discount: $("calcDiscount").value,
    minimum_fee: $("calcMinimum").value,
  };
  $("calcStatus").textContent = "正在計算成交金額與成本…";
  try {
    const data = await utilityPost("/api/calculator", request);
    if (version !== calcVersion || key !== stockKey()) return;
    if (
      request.close_change_percent != null ||
      request.close_tick_change != null
    ) {
      const closing = data.legs.at(-1);
      $(closing.side === "buy" ? "calcBuyPrice" : "calcSellPrice").value =
        closing.price;
    }
    const tickMode = data.scenario_mode === "ticks";
    if (data.tick_info) {
      const describe = (label, info) =>
        info
          ? `${label}一檔 ${utilityMoney(info.difference)} 元／股，${utilityMoney(data.shares)} 股價差 ${utilityMoney(info.gross_amount)} 元`
          : `${label}已達試算價格邊界`;
      $("calcTickNote").textContent =
        `進場 ${utilityMoney(data.scenario_anchor)} 元 · ${describe("上跳", data.tick_info.up)}；${describe("下跳", data.tick_info.down)}。未扣手續費與稅，跨級距會逐檔換算。`;
    }
    $("calcScenarioRows").replaceChildren();
    (data.scenarios || []).forEach((scenario) => {
      const tr = document.createElement("tr"),
        cell = document.createElement("td"),
        change = tickMode
          ? scenario.tick_change
          : Number(scenario.change_percent);
      const button = utilityText(
        cell,
        "button",
        change === 0
          ? "原價"
          : `${change > 0 ? "+" : ""}${utilityMoney(change)}${tickMode ? " 檔" : "%"}`,
        "quiet",
      );
      button.type = "button";
      button.setAttribute(
        "aria-pressed",
        String(
          mode.startsWith("day_") &&
            (tickMode
              ? request.close_tick_change === scenario.tick_change
              : Number(request.close_change_percent) ===
                Number(scenario.change_percent)),
        ),
      );
      button.onclick = () => {
        calcChosenTicks = tickMode ? scenario.tick_change : null;
        calcChosenChange = tickMode ? null : scenario.change_percent;
        $("calcCloseTicks").value = tickMode ? scenario.tick_change : "";
        if (!mode.startsWith("day_")) $("calcSellPrice").value = scenario.price;
        calcSettings();
        runCalculator();
      };
      tr.append(cell);
      textCell(tr, utilityMoney(scenario.price));
      const priceCell = utilityText(
        tr,
        "td",
        `${Number(scenario.price_difference) > 0 ? "+" : ""}${utilityMoney(scenario.price_difference)} 元`,
      );
      utilityText(
        priceCell,
        "small",
        utilityMoney(scenario.actual_change_percent) + "%",
      );
      textCell(tr, utilityMoney(scenario.gross_profit) + " 元");
      utilityText(
        tr,
        "td",
        utilityMoney(scenario.net_profit) + " 元",
        Number(scenario.net_profit) > 0
          ? "up"
          : Number(scenario.net_profit) < 0
            ? "down"
            : "",
      );
      $("calcScenarioRows").append(tr);
    });
    $("calcStatus").textContent =
      `${state.stock.name} ${state.stock.symbol} · ${utilityMoney(data.shares)} 股 · 每邊有效手續費 ${data.effective_fee_percent}% · 賣出交易稅 ${data.tax_percent}%`;
    if (mode.startsWith("day_"))
      $("calcStatus").textContent +=
        ` · ${request.close_tick_change != null || request.close_change_percent != null ? "目前情境 " + utilityMoney(tickMode ? request.close_tick_change : request.close_change_percent) + (tickMode ? " 檔" : "%") : "依輸入買賣價"} · ${mode === "day_short" ? "回補買價" : "出場賣價"} ${utilityMoney(data.legs.at(-1).price)} 元`;
    const cards =
      data.net_profit == null
        ? [
            [
              mode === "buy" ? "買入所需金額" : "賣出可收金額",
              utilityMoney(
                mode === "buy" ? -Number(data.cash_flow) : data.cash_flow,
              ) + " 元",
            ],
            ["手續費", utilityMoney(data.fees) + " 元"],
            ["交易稅", utilityMoney(data.tax) + " 元"],
            ["其他成本", utilityMoney(data.extra_cost) + " 元"],
          ]
        : [
            ["扣除成本後淨損益", utilityMoney(data.net_profit) + " 元"],
            ["試算報酬率", data.return_percent + "%"],
            ["雙邊手續費", utilityMoney(data.fees) + " 元"],
            [
              "交易稅＋其他成本",
              utilityMoney(Number(data.tax) + Number(data.extra_cost)) + " 元",
            ],
          ];
    cards.forEach(([label, value], i) => {
      const card = document.createElement("div");
      utilityText(card, "span", label);
      utilityText(
        card,
        "strong",
        value,
        i === 0 && data.net_profit != null
          ? Number(data.net_profit) > 0
            ? "up"
            : Number(data.net_profit) < 0
              ? "down"
              : ""
          : "",
      );
      $("calcResults").append(card);
    });
    data.legs.forEach((leg, i) => {
      const tr = document.createElement("tr");
      [
        `${i + 1} · ${leg.side === "buy" ? "買進" : "賣出"}`,
        utilityMoney(leg.amount),
        utilityMoney(leg.fee),
        utilityMoney(leg.tax),
        (Number(leg.cash_flow) > 0 ? "+" : "") + utilityMoney(leg.cash_flow),
      ].forEach((v) => textCell(tr, v));
      $("calcLegs").append(tr);
    });
    $("calcBreakEven").textContent =
      data.net_profit == null
        ? "單邊試算只有成本或實收，沒有平倉損益。"
        : data.breakeven_price
          ? `${data.breakeven_side === "buy" ? "回補買進價不高於" : "賣出價格不低於"} ${utilityMoney(data.breakeven_price)} 元時，按這組設定可達損益兩平。已依所選商品升降單位調整；不是價格預測。`
          : "這組成本設定在試算價格範圍內無法達到損益兩平。";
    $("calcNotes").textContent =
      (data.return_percent != null
        ? "報酬率分母：" + data.return_basis + "。"
        : "") + data.note;
  } catch (error) {
    if (version === calcVersion && key === stockKey())
      $("calcStatus").textContent = error.message;
  }
}

async function refreshPeers() {
  const version = ++peerVersion,
    key = stockKey();
  peerBusy = true;
  peerData = null;
  $("peerSummary").replaceChildren();
  $("peerChart").replaceChildren();
  $("peerRows").replaceChildren();
  $("peerSources").replaceChildren();
  const params = new URLSearchParams({
    reference: $("peerDate").value,
    view_mode: $("peerViewMode").value,
    alignment: $("peerAlignment").value,
  });
  if (peerList.length)
    params.set(
      "symbols",
      peerList.map((i) => i.market + ":" + i.symbol).join(","),
    );
  $("peerStatus").textContent = "正在對齊公司、來源與資料期間…";
  try {
    const data = await analysisJson(
      `/api/peers/${state.stock.market}/${state.stock.symbol}?${params}`,
    );
    if (version !== peerVersion || key !== stockKey()) return;
    peerData = data;
    peerList = data.rows.map((r) => ({
      market: r.market,
      symbol: r.symbol,
      name: r.name,
    }));
    renderPeerSelection();
    renderPeers();
    if (data.view_mode === "latest" && !$("loadPeers").disabled) {
      const missing = data.rows
        .filter(
          (r) =>
            r.load_required &&
            !peerAutoAttempted.has(r.market + ":" + r.symbol),
        )
        .sort(
          (a, b) =>
            Number(b.selected) - Number(a.selected) ||
            Number(b.business_peer) - Number(a.business_peer),
        );
      if (missing.length) loadPeerData(missing);
    }
  } catch (error) {
    if (version === peerVersion && key === stockKey())
      $("peerStatus").textContent = error.message;
  } finally {
    if (version === peerVersion) peerBusy = false;
  }
}

function renderPeerSelection() {
  $("peerSelection").replaceChildren();
  peerList.forEach((item) => {
    const button = document.createElement("button");
    const selected = item.market + ":" + item.symbol === stockKey();
    button.className = "quiet";
    button.textContent = `${item.name} ${item.symbol}${selected ? " · 本檔" : " ×"}`;
    button.disabled = selected;
    button.onclick = () => {
      peerList = peerList.filter((i) => i !== item);
      refreshPeers();
    };
    $("peerSelection").append(button);
  });
}

function renderPeers() {
  const data = peerData;
  if (!data) return;
  const filter = $("peerFilter").value.trim().toLowerCase(),
    business = $("peerScope").value === "business";
  const filtered = data.rows.filter(
    (r) =>
      (!business || r.business_peer || r.selected) &&
      (!filter || (r.name + r.symbol).toLowerCase().includes(filter)),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  peerPage = Math.min(peerPage, pages - 1);
  const visible = filtered.slice(peerPage * 10, peerPage * 10 + 10);
  $("peerPageInfo").textContent =
    `${data.rows.length} 檔完整名單 · 篩選 ${filtered.length} 檔 · ${peerPage + 1}/${pages} 頁`;
  $("peerPrevious").disabled = peerPage === 0;
  $("peerNext").disabled = peerPage >= pages - 1;

  $("peerIndustry").textContent = data.industry || "產業分類未取得";
  $("peerBasis").replaceChildren();
  utilityText(
    $("peerBasis"),
    "span",
    `名單依據：${data.selection_basis.label}。${data.selection_basis.detail}`,
  );
  data.selection_basis.sources.forEach((url, i) => {
    const link = utilityText($("peerBasis"), "a", ` 公司資料${i + 1}`);
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
  });
  $("peerStatus").textContent =
    `截至 ${data.reference_day} · ${data.rows.length} 檔 · ${data.alignment === "common" ? "同資料集採共同期間" : "各公司採最新期間，請核對日期"} · ${data.view_mode === "historical" ? "當時平台可得" : "最新修訂重看歷史"}`;
  $("peerNotes").textContent = data.note;
  $("peerMetricButtons").replaceChildren();
  data.fields.forEach((field) => {
    const button = document.createElement("button");
    button.textContent = field.label;
    button.className = "quiet";
    button.setAttribute("aria-pressed", String(peerMetric === field.key));
    button.onclick = () => {
      peerMetric = field.key;
      renderPeers();
    };
    $("peerMetricButtons").append(button);
  });
  const field = data.fields.find((f) => f.key === peerMetric),
    target = data.rows.find((r) => r.selected),
    value = target?.metrics[peerMetric];
  const scopeRows = business
    ? data.rows.filter((r) => r.business_peer || r.selected)
    : data.rows;
  const values = scopeRows
    .filter(
      (r) =>
        !r.selected &&
        r.same_industry &&
        value?.status === "available" &&
        r.metrics[peerMetric].status === "available" &&
        r.metrics[peerMetric].period === value.period,
    )
    .map((r) => r.metrics[peerMetric].value)
    .sort((a, b) => a - b);
  const reference = business
    ? {
        count: values.length,
        value:
          values.length >= 2
            ? values.length % 2
              ? values[(values.length - 1) / 2]
              : (values[values.length / 2 - 1] + values[values.length / 2]) / 2
            : null,
      }
    : data.medians[peerMetric];
  $("peerSummary").replaceChildren();
  [
    [
      "本檔" + field.label,
      value?.status === "available"
        ? utilityMoney(value.value) + " " + field.unit
        : value?.status === "stale"
          ? "資料過期"
          : "資料不足",
    ],
    [
      business ? "同期業務相近中位數" : "同期產業大分類中位數",
      reference.value == null
        ? "樣本不足"
        : utilityMoney(reference.value) + " " + field.unit,
    ],
    ["比較公司有效樣本", reference.count + " 家（不含本檔）"],
    ["本檔資料期間", value?.period || "無共同期／尚未取得"],
  ].forEach(([label, text]) => {
    const card = document.createElement("div");
    utilityText(card, "span", label);
    utilityText(card, "strong", text);
    $("peerSummary").append(card);
  });
  $("peerChart").replaceChildren();
  const valid = scopeRows.filter(
      (r) => r.metrics[peerMetric].status === "available",
    ),
    max = Math.max(
      1,
      ...valid.map((r) => Math.abs(r.metrics[peerMetric].value)),
    );
  visible.forEach((row) => {
    const cell = row.metrics[peerMetric],
      item = document.createElement("div");
    item.className = "peer-chart-row" + (row.selected ? " selected" : "");
    utilityText(item, "span", `${row.name} ${row.symbol}`);
    const track = document.createElement("div");
    track.className = "peer-chart-track";
    const fill = document.createElement("i");
    fill.style.width =
      (cell.status === "available" ? (Math.abs(cell.value) / max) * 100 : 0) +
      "%";
    fill.className = cell.value < 0 ? "negative" : "";
    track.append(fill);
    item.append(track);
    utilityText(
      item,
      "strong",
      cell.status === "available"
        ? utilityMoney(cell.value) + field.unit
        : cell.status === "stale"
          ? "過期"
          : "—",
    );
    utilityText(
      item,
      "small",
      (cell.period || "尚無資料") +
        (row.same_industry ? "" : " · 跨產業，不計中位數"),
    );
    $("peerChart").append(item);
  });
  const groups = {
      valuation: ["per", "pbr", "dividend_yield"],
      operation: ["revenue_yoy", "eps", "gross_margin", "operating_margin"],
      structure: ["debt_ratio"],
    },
    keys = groups[$("peerTableGroup").value];
  $("peerHead").replaceChildren();
  const header = document.createElement("tr");
  [
    "股票／產業",
    ...keys.map((key) => data.fields.find((f) => f.key === key).label),
  ].forEach((label) => utilityText(header, "th", label));
  $("peerHead").append(header);
  $("peerRows").replaceChildren();
  visible.forEach((row) => {
    const tr = document.createElement("tr");
    const first = document.createElement("td");
    utilityText(
      first,
      "strong",
      `${row.name} ${row.symbol}${row.selected ? " · 本檔" : ""}`,
    );
    utilityText(
      first,
      "small",
      `${row.market} · ${row.industry || "未分類"} · ${row.business_peer ? "業務相近組" : row.same_industry ? "產業大分類候選" : "跨產業"}`,
    );
    tr.append(first);
    keys.forEach((key) => {
      const metric = row.metrics[key],
        cell = document.createElement("td"),
        unit = data.fields.find((f) => f.key === key).unit;
      utilityText(
        cell,
        "strong",
        metric.status === "available"
          ? utilityMoney(metric.value) + unit
          : metric.status === "stale"
            ? "過期"
            : "—",
      );
      if (metric.reason) utilityText(cell, "small", metric.reason);
      utilityText(cell, "small", metric.period || "無共同期／未接收");
      tr.append(cell);
    });
    $("peerRows").append(tr);
  });
  $("peerSources").replaceChildren();
  visible.forEach((row) => {
    const section = document.createElement("section");
    utilityText(
      section,
      "h4",
      `${row.name} ${row.symbol} · 可用 ${row.available}/${data.fields.length} 項`,
    );
    const sources = new Set();
    Object.values(row.metrics).forEach((metric) => {
      if (metric.source)
        sources.add(
          `${metric.source.source} · 接收 ${localTime(metric.source.received_at)} · 修訂 ${metric.source.revision}`,
        );
    });
    utilityText(
      section,
      "p",
      [...sources].join("；") ||
        "此視角尚未接收財務來源。請用補齊資料按鈕擷取；現在擷取的資料不會回填成當時已知。",
    );
    $("peerSources").append(section);
  });
}

let peerSearchTimer;

async function loadPeerData(items = peerList) {
  if ($("peerViewMode").value === "historical") {
    $("peerLoadStatus").textContent =
      "歷史可得視角不回填現在擷取的資料；請切到目前取得修訂進行補齊。";
    return;
  }
  const version = ++peerLoadVersion,
    key = stockKey(),
    list = items.slice();
  if (!list.length) return;
  $("loadPeers").disabled = true;
  const current = () => version === peerLoadVersion && key === stockKey();
  let failures = 0;
  try {
    for (let i = 0; i < list.length; i++) {
      if (!current()) return;
      const stock = list[i];
      if (
        !peerList.some(
          (s) => s.market === stock.market && s.symbol === stock.symbol,
        )
      )
        continue;
      $("peerLoadStatus").textContent =
        `補齊 ${i + 1}/${list.length}：${stock.name} ${stock.symbol}；完整產業名單較多，依來源配額循序處理，已取得的資料先顯示。`;
      peerAutoAttempted.add(stock.market + ":" + stock.symbol);
      const queued = await utilityPost("/api/fundamentals/load", {
        market: stock.market,
        symbol: stock.symbol,
      });
      let job = await analysisJson("/api/jobs/" + queued.job_id),
        attempt = 0;
      while (["queued", "running"].includes(job.status) && attempt++ < 300) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (!current()) return;
        job = await analysisJson("/api/jobs/" + queued.job_id);
      }
      if (["queued", "running"].includes(job.status))
        throw Error("來源仍在處理；可稍後更新比較查看結果。");
      if (job.status !== "success")
        $("peerLoadStatus").textContent =
          `${stock.name}有來源未成功，保留缺漏並繼續補齊其他公司。`;
      if (current()) await refreshPeers();
      failures = Object.values(job.details?.datasets || {}).some(
        (s) => s.status === "failed",
      )
        ? failures + 1
        : 0;
      if (failures >= 3) {
        if (current())
          $("peerLoadStatus").textContent =
            "連續三家公司來源失敗，已保留取得資料並停止本批，避免持續消耗配額；稍後可按補齊名單重試。";
        return;
      }
    }
    if (current())
      $("peerLoadStatus").textContent =
        "名單擷取工作已完成；失敗、過期或沒有共同期的項目仍標示缺漏，請查看來源。";
  } catch (error) {
    if (current()) $("peerLoadStatus").textContent = error.message;
  } finally {
    if (current()) $("loadPeers").disabled = false;
  }
}

export function initUtilityController() {
  $("calcDate").value = taipeiDay();
  $("peerDate").value = state.range?.end || taipeiDay();
  $("calculatorForm").onsubmit = (event) => {
    event.preventDefault();
    clearTimeout(calcTimer);
    runCalculator();
  };
  $("calcCloseTicks").addEventListener("input", () => {
    calcChosenTicks =
      $("calcCloseTicks").value === ""
        ? null
        : Number($("calcCloseTicks").value);
    calcChosenChange = null;
  });
  for (const side of ["Buy", "Sell"]) {
    $("calc" + side + "Price").addEventListener("input", () => {
      const mode = $("calcMode").value,
        closing = mode === "day_short" ? "Buy" : "Sell";
      if (mode.startsWith("day_") && side === closing) {
        calcChosenChange = calcChosenTicks = null;
        $("calcCloseTicks").value = "";
      }
    });
  }
  for (const side of ["Buy", "Sell"]) {
    const input = $("calc" + side + "Price");
    const move = (direction) => {
      const price = calcAdjacentPrice(
        input.value,
        direction,
        $("calcAsset").value,
      );
      if (input.disabled || price == null) return;
      input.value = price;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    $("calc" + side + "Down").onclick = () => move(-1);
    $("calc" + side + "Up").onclick = () => move(1);
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        move(event.key === "ArrowUp" ? 1 : -1);
      }
    });
  }
  $("calculatorForm").addEventListener("input", () => {
    calcVersion++;
    clearTimeout(calcTimer);
    calcSettings();
    calcTimer = setTimeout(runCalculator, 300);
  });
  ["calcMode", "calcAsset", "calcDate"].forEach((id) =>
    $(id).addEventListener("change", () => {
      calcSettings(true);
      runCalculator();
    }),
  );
  $("calcMode").addEventListener("change", () => {
    calcChosenChange = null;
    calcChosenTicks = null;
    $("calcCloseTicks").value = "";
    calcSettings();
    runCalculator();
  });
  [
    "calcUpStep",
    "calcDownStep",
    "calcSteps",
    "calcTickStep",
    "calcScenarioMode",
  ].forEach((id) =>
    $(id).addEventListener("input", () => {
      calcChosenChange = null;
      calcChosenTicks = null;
    }),
  );
  ["calcAsset", "calcScenarioMode", "calcTickStep"].forEach((id) =>
    $(id).addEventListener("change", () => {
      calcChosenChange = null;
      calcChosenTicks = null;
      $("calcCloseTicks").value = "";
      calcSettings();
      runCalculator();
    }),
  );
  $("calcUnit").addEventListener("change", runCalculator);
  $("calcUsePrice").onclick = () => {
    const quote = state.mode === "live" ? state.quote : null,
      bar = analysisBar();
    let price, description;
    if (quote?.last_price != null) {
      price = quote.last_price;
      description = `公開快照 ${quote.trade_date} · ${localTime(quote.trade_time)} · ${quote.state_label}；試算價格需自行確認。`;
    } else if (
      bar &&
      bar.price_basis !== "adjusted" &&
      $("priceBasis").value === "raw"
    ) {
      price = bar.close;
      description = `${bar.trade_date} ${periodLabel()}K ${bar.is_final ? "收盤" : "未完成"}原始價；歷史價格不是即時成交價。`;
    }
    if (price == null) {
      $("calcPriceNote").textContent =
        "尚無可用原始價；還原價不能直接當成交價，請自行輸入或切換原始價。";
      return;
    }
    $("calcBuyPrice").value = $("calcSellPrice").value = price;
    $("calcPriceNote").textContent = description;
    runCalculator();
  };
  $("refreshPeers").onclick = refreshPeers;
  ["peerDate", "peerAlignment"].forEach(
    (id) => ($(id).onchange = refreshPeers),
  );
  $("peerTableGroup").onchange = renderPeers;
  $("peerViewMode").onchange = () => {
    peerLoadVersion++;
    $("loadPeers").disabled = false;
    $("peerLoadStatus").textContent = "";
    refreshPeers();
  };
  $("peerSearch").oninput = () => {
    const version = ++peerSearchVersion;
    clearTimeout(peerSearchTimer);
    $("peerSuggestions").replaceChildren();
    const query = $("peerSearch").value.trim();
    if (!query) return;
    peerSearchTimer = setTimeout(async () => {
      try {
        const rows = await analysisJson(
          "/api/search?q=" + encodeURIComponent(query),
        );
        if (version !== peerSearchVersion) return;
        rows.forEach((item) => {
          const button = document.createElement("button");
          button.className = "quiet";
          button.textContent = `${item.name} ${item.symbol} · ${item.industry}`;
          button.onclick = () => {
            if (peerList.length >= 400) {
              $("peerStatus").textContent = "比較名單已達上限。";
              return;
            }
            if (
              !peerList.some(
                (i) => i.symbol === item.symbol && i.market === item.market,
              )
            )
              peerList.push(item);
            $("peerSuggestions").replaceChildren();
            $("peerSearch").value = "";
            refreshPeers();
          };
          $("peerSuggestions").append(button);
        });
      } catch (error) {
        if (version === peerSearchVersion)
          $("peerStatus").textContent = error.message;
      }
    }, 250);
  };
  $("loadPeers").onclick = () => loadPeerData();
  $("peerFilter").oninput = $("peerScope").onchange = () => {
    peerPage = 0;
    renderPeers();
  };
  $("peerPrevious").onclick = () => {
    peerPage = Math.max(0, peerPage - 1);
    renderPeers();
  };
  $("peerNext").onclick = () => {
    peerPage++;
    renderPeers();
  };
  utilitiesChanged();
}

export const calculatorContext = {
  get peerData() {
    return peerData;
  },
  get change() {
    return calcChosenChange;
  },
  set change(value) {
    calcChosenChange = value;
  },
  get ticks() {
    return calcChosenTicks;
  },
  set ticks(value) {
    calcChosenTicks = value;
  },
};
export {
  utilityStock,
  calcVersion,
  calcTimer,
  peerVersion,
  peerBusy,
  peerData,
  peerList,
  peerMetric,
  peerLoadVersion,
  peerSearchVersion,
  peerAutoAttempted,
  peerPage,
  calcChosenChange,
  calcChosenTicks,
  utilityMoney,
  calcAdjacentPrice,
  utilityPost,
  utilityText,
  utilitiesChanged,
  calcSettings,
  runCalculator,
  refreshPeers,
  renderPeerSelection,
  renderPeers,
  peerSearchTimer,
  loadPeerData,
};
