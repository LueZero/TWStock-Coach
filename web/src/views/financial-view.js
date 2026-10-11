import { $, fmt, textCell } from "./dashboard-view.js";
import { state } from "./../models/stock-model.js";
import { emptyMetric, researchCard, researchNumber } from "./research-view.js";
import { renderFinancialHistory } from "./financial-chart.js";

let financialCategory = "profitability";

const financialPages = {
  statements: "monthly-revenue",
  profitability: "profit-margin",
  safety: "financial-structure-ratio",
  growth: "monthly-revenue-growth-rate",
  valuation: "pe",
};

let financialStatementEnd = "";

const financialTrendPreferences = new Map();

const financialChartState = { observer: null };

const financialStatusLabels = {
  available: "可查看",
  partial: "部分資料",
  dependency_missing: "計算條件不足",
  no_data: "未取得",
  reference: "官方入口",
};

function renderFinancialResearch(data) {
  financialChartState.observer?.disconnect();
  financialChartState.observer = null;
  const container = $("financialMetrics");
  container.replaceChildren();
  const groups = data?.catalog?.groups || [];
  document
    .querySelectorAll("[data-financial-category]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.financialCategory === financialCategory),
      ),
    );
  const group = groups.find((g) => g.id === financialCategory),
    pages = group?.pages || [];
  const nav = $("financialSubpages"),
    select = $("financialSubpageSelect");
  nav.replaceChildren();
  select.replaceChildren();
  let page =
    pages.find((p) => p.id === financialPages[financialCategory]) || pages[0];
  if (page) financialPages[financialCategory] = page.id;
  const choose = (id) => {
    financialPages[financialCategory] = id;
    financialStatementEnd = "";
    renderFinancialResearch(state.financialData);
  };
  pages.forEach((item) => {
    const button = document.createElement("button");
    button.className = "financial-subpage";
    button.dataset.financialPage = item.id;
    button.setAttribute("aria-pressed", String(item.id === page?.id));
    const label = document.createElement("span");
    label.textContent = item.label;
    const status = document.createElement("small");
    status.textContent = financialStatusLabels[item.status];
    status.dataset.status = item.status;
    button.append(label, status);
    button.onclick = () => choose(item.id);
    nav.append(button);
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = `${item.label} · ${financialStatusLabels[item.status]}`;
    select.append(option);
  });
  if (page) select.value = page.id;
  select.onchange = () => choose(select.value);
  $("financialCategoryNote").textContent = page
    ? `${group.label} ／ ${page.label}`
    : "財務細項載入中";
  if (
    !page ||
    !(
      data.metrics.some((m) => m.value != null) ||
      Object.values(data.statements || {}).some((r) => r.rows.length) ||
      data.dividends?.length
    )
  ) {
    $("financialSummary").textContent =
      "此視角尚無可用財務資料。缺資料不代表公司衰退，請核對載入狀態與歷史取得時間。";
    return;
  }
  const heading = document.createElement("div");
  heading.className = "financial-detail-heading";
  const title = document.createElement("h3");
  title.textContent = page.label;
  const badge = document.createElement("span");
  badge.className = "financial-availability";
  badge.dataset.status = page.status;
  badge.textContent = financialStatusLabels[page.status];
  heading.append(title, badge);
  container.append(heading);
  if (page.note) {
    const note = document.createElement("p");
    note.className = "utility-note";
    note.textContent = page.note;
    container.append(note);
  }
  if (page.requires) {
    const warning = document.createElement("div");
    warning.className = "financial-dependency";
    warning.setAttribute("role", "note");
    const name = document.createElement("strong");
    name.textContent = "這項計算尚不能可靠產出";
    const reason = document.createElement("p");
    reason.textContent = page.requires;
    warning.append(name, reason);
    container.append(warning);
  }
  const cards = document.createElement("div");
  cards.className = "research-cards";
  const metrics = page.keys.map(
    (key) =>
      data.metrics.find((m) => m.key === key) ||
      emptyMetric(
        key,
        financialMetricLabels[key] || key,
        "",
        "來源未提供必要科目或沒有可配對期間；缺值不假設為零。",
      ),
  );
  metrics.forEach((metric) => {
    researchCard(cards, metric, data.history?.[metric.key] || []);
    if (metric.comparison?.value != null) {
      const comparison = document.createElement("div");
      comparison.className = "financial-comparison";
      comparison.textContent = `去年同期 ${metric.comparison.period}：${researchNumber(metric.comparison.value, metric.unit)} ${metric.unit} · 差異 ${metric.comparison.difference > 0 ? "+" : ""}${fmt(metric.comparison.difference)} ${metric.comparison.unit}`;
      cards.lastElementChild.append(comparison);
    }
  });
  if (metrics.length) container.append(cards);
  if (metrics.length) renderFinancialHistory(data, metrics, container);
  if (page.report) renderFinancialStatement(data, page);
  if (page.kind === "dividends") renderFinancialDividends(data, container);
  if (page.kind === "documents") {
    const reference = document.createElement("div");
    reference.className = "financial-document";
    const text = document.createElement("p");
    text.textContent = `股票 ${state.stock.symbol}：進入官方網站後，選擇公司代號與年度，查詢財務報告或年報。未匯入原始文件前，不宣稱已解析電子書。`;
    const link = document.createElement("a");
    link.href = "https://mops.twse.com.tw/mops/#/web/home";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "公開資訊觀測站：財報／年報 ↗";
    reference.append(text, link);
    container.append(reference);
  }
  const good = metrics.filter((m) => m.assessment?.tone === "good").length,
    bad = metrics.filter((m) => m.assessment?.tone === "bad").length,
    watch = metrics.filter((m) => m.assessment?.tone === "watch").length;
  $("financialSummary").textContent = page.requires
    ? "主項目尚缺計算條件；下方相關資料不能替代完整指標。"
    : metrics.length
      ? `${good} 項改善／強勢 · ${bad} 項衰退 · ${watch} 項需留意 · 比較條件詳見各卡片`
      : "原始報表與官方文件；缺值不補成零。";
}

const financialMetricLabels = {
  revenue: "月營收",
  revenue_yoy: "月營收年增率",
  revenue_mom: "月營收月增率",
  eps: "單季每股盈餘",
  selling_ratio: "推銷費用率",
  admin_ratio: "管理費用率",
  research_ratio: "研發費用率",
  expense_ratio: "營業費用率",
  cash_dividend: "事件現金股利",
  stock_dividend: "事件股票股利",
  interest_coverage: "利息保障倍數",
  contract_ratio: "合約負債佔營收比例",
  contract_yoy: "合約負債年增率",
  asset_turnover: "總資產週轉率",
  inventory_turnover: "存貨週轉率",
  receivable_turnover: "應收帳款週轉率",
  inventory_days: "存貨週轉天數",
  receivable_days: "應收帳款週轉天數",
  cash_profit_ratio: "年度營業現金流對淨利比",
};

function renderFinancialStatement(data, page) {
  const report = data.statements?.[page.report];
  if (!report?.rows.length) {
    const note = document.createElement("p");
    note.className = "research-empty";
    note.textContent = "此視角沒有可用報表。";
    $("financialMetrics").append(note);
    return;
  }
  const wrapper = document.createElement(
    page.kind === "statement" ? "section" : "details",
  );
  wrapper.className = "financial-evidence";
  const title = document.createElement(
    page.kind === "statement" ? "h4" : "summary",
  );
  title.textContent =
    page.kind === "statement"
      ? `${report.label} · 原始科目`
      : "查看計算依據與四期報表明細";
  wrapper.append(title);
  const tools = document.createElement("div");
  tools.className = "utility-fields";
  const label = document.createElement("label");
  label.textContent = "截至季度";
  const select = document.createElement("select");
  select.setAttribute("aria-label", "財務報表截至期間");
  report.periods.forEach((period) => {
    const o = document.createElement("option");
    o.value = period;
    o.textContent = period;
    select.append(o);
  });
  if (!report.periods.includes(financialStatementEnd))
    financialStatementEnd = report.periods[0];
  select.value = financialStatementEnd;
  // Update only the table to preserve focus and expanded details.
  label.append(select);
  tools.append(label);
  wrapper.append(tools);
  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  wrapper.append(scroll);
  const draw = () => {
    scroll.replaceChildren();
    const periods = report.periods.filter((p) => p <= select.value).slice(0, 4);
    const rows = report.rows.filter(
      (r) =>
        (page.fields == null || page.fields.includes(r.key)) &&
        periods.includes(r.period),
    );
    if (!rows.length) {
      scroll.textContent = "來源未提供此項必要科目；請查詢原始報告，不補成零。";
      return;
    }
    const table = document.createElement("table");
    table.className = "history-table utility-table";
    const head = document.createElement("thead"),
      tr = document.createElement("tr");
    ["科目／單位", ...periods].forEach((v) => {
      const th = document.createElement("th");
      th.textContent = v;
      tr.append(th);
    });
    head.append(tr);
    table.append(head);
    const body = document.createElement("tbody");
    [...new Set(rows.map((r) => r.key))].forEach((key) => {
      const samples = rows.filter((r) => r.key === key),
        first = samples[0],
        row = document.createElement("tr");
      textCell(row, `${first.label}（${first.unit}）`);
      periods.forEach((period) =>
        textCell(
          row,
          samples.find((r) => r.period === period)?.value == null
            ? "—"
            : new Intl.NumberFormat("zh-TW", {
                maximumFractionDigits: 2,
              }).format(samples.find((r) => r.period === period).value),
        ),
      );
      body.append(row);
    });
    table.append(body);
    scroll.append(table);
  };
  select.onchange = () => {
    financialStatementEnd = select.value;
    draw();
  };
  draw();
  $("financialMetrics").append(wrapper);
}

function renderFinancialDividends(data, container) {
  const rows = data.dividends || [];
  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "history-table utility-table";
  const head = document.createElement("thead"),
    tr = document.createElement("tr");
  [
    "來源事件日期",
    "盈餘年度",
    "現金股利／股",
    "股票股利／股",
    "除息交易日",
    "現金發放日",
  ].forEach((text) => {
    const th = document.createElement("th");
    th.textContent = text;
    tr.append(th);
  });
  head.append(tr);
  table.append(head);
  const body = document.createElement("tbody");
  const amount = (r, keys) =>
    keys.every((k) => r[k] != null && Number.isFinite(Number(r[k])))
      ? keys.reduce((a, k) => a + Number(r[k]), 0)
      : null;
  rows.forEach((r) => {
    const row = document.createElement("tr");
    [
      r.date,
      r.year,
      fmt(amount(r, ["CashEarningsDistribution", "CashStatutorySurplus"])),
      fmt(amount(r, ["StockEarningsDistribution", "StockStatutorySurplus"])),
      r.CashExDividendTradingDate || "—",
      r.CashDividendPaymentDate || "—",
    ].forEach((v) => textCell(row, v));
    body.append(row);
  });
  if (!rows.length) {
    const row = document.createElement("tr"),
      cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "此視角尚未取得股利事件，不代表沒有配息。";
    row.append(cell);
    body.append(row);
  }
  table.append(body);
  scroll.append(table);
  container.append(scroll);
}

export function initFinancialView() {
  Object.assign(financialMetricLabels, {
    gross_margin: "毛利率",
    operating_margin: "營業利益率",
    pretax_margin: "稅前淨利率",
    net_margin: "稅後淨利率",
    dupont_net_margin: "杜邦同季淨利率",
    nonoperating_ratio: "業外佔稅前淨利比例",
    roe_quarter: "單季權益報酬率",
    roa_quarter: "單季資產報酬率",
    equity_multiplier: "平均資產／平均權益",
    total_assets: "總資產",
    current_assets: "流動資產",
    noncurrent_assets: "非流動資產",
    liabilities: "總負債",
    equity: "總權益",
    debt_ratio: "負債比率",
    equity_ratio: "權益比率",
    long_capital_ratio: "長期資金占固定資產比率",
    current_ratio: "流動比率",
    quick_ratio: "速動比率",
    operating_cash: "營業活動淨現金流",
    investing_cash: "投資活動淨現金流",
    financing_cash: "籌資活動淨現金流",
    capex: "取得設備等資本支出",
    free_cash: "自由現金流參考",
    sales_yoy: "單季營收年增率",
    gross_yoy: "單季毛利年增率",
    operating_yoy: "單季營業利益年增率",
    net_yoy: "單季稅後淨利年增率",
    per: "本益比",
    pbr: "股價淨值比",
    dividend_yield: "現金股利殖利率",
  });
  Object.assign(financialMetricLabels, {
    roa_interest_adjusted: "單季ROA（稅後利息加回）",
    roe_ttm: "近四季ROE",
    reinvestment_ratio: "盈餘再投資比率",
    sales_amount: "單季營收",
    gross_amount: "單季毛利",
    operating_amount: "單季營業利益",
    net_amount: "單季稅後淨利",
    sales_ttm_yoy: "近四季營收年增率",
    gross_ttm_yoy: "近四季毛利年增率",
    operating_ttm_yoy: "近四季營業利益年增率",
    net_ttm_yoy: "近四季稅後淨利年增率",
    contract_qoq: "合約負債季增率",
    cash_balance: "現金及約當現金",
    receivable_amount: "應收帳款及票據",
    short_investments: "短期投資",
    long_investments: "長期投資（權益法）",
    inventory_amount: "存貨",
    fixed_assets: "固定資產",
    depreciation_quarter: "單季折舊",
    amortization_quarter: "單季攤銷",
    operating_cash_quarter: "單季營業現金流",
    investing_cash_quarter: "單季投資現金流",
    financing_cash_quarter: "單季融資現金流",
    capex_quarter: "單季設備取得支出",
    free_cash_quarter: "單季自由現金流參考",
    cash_change_quarter: "單季淨現金流",
    cash_current_debt_ratio: "營業現金對流動負債比",
    cash_debt_ratio: "營業現金對負債比",
    cash_profit_quarter_ratio: "單季營業現金對稅後淨利比",
    receivable_total_turnover: "應收帳款及票據週轉",
    receivable_total_days: "應收帳款及票據收現天數",
    inventory_days_reference: "存貨週轉天數",
  });
  Object.assign(financialMetricLabels, {
    selling_amount: "銷售費用",
    admin_amount: "管理費用",
    research_amount: "研發費用",
    expense_amount: "營業費用",
    pretax_amount: "稅前淨利",
    parent_net_amount: "母公司業主淨利",
    short_borrowings: "短期借款",
    short_notes_payable: "應付短期票券",
    payable_amount: "應付帳款及票據",
    advance_receipts: "預收款項",
    current_long_debt: "一年內到期長期負債",
    current_liabilities: "流動負債",
    long_liabilities: "長期負債（長期借款）",
  });
  document.querySelectorAll("[data-financial-category]").forEach(
    (button) =>
      (button.onclick = () => {
        financialCategory = button.dataset.financialCategory;
        financialStatementEnd = "";
        renderFinancialResearch(state.financialData);
      }),
  );
}

export {
  financialCategory,
  financialPages,
  financialStatementEnd,
  financialTrendPreferences,
  financialChartState,
  financialStatusLabels,
  renderFinancialResearch,
  financialMetricLabels,
  renderFinancialStatement,
  renderFinancialDividends,
};
