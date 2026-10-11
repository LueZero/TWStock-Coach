import {
  pick,
  div,
  average,
  previousQuarter,
  priorYear,
  latestKey,
  strictSum,
  daysBetween,
  num,
} from "./lib.js";
const I = "TaiwanStockFinancialStatements",
  B = "TaiwanStockBalanceSheet",
  C = "TaiwanStockCashFlowsStatement";
export function extendMetrics(
  income,
  balance,
  cash,
  dividends,
  metrics,
  cashRows = [],
  incomeRows = [],
) {
  const emit = (key, label, value, period, unit, note, datasets) => {
    const m = {
      key,
      label,
      value: value ?? null,
      period,
      unit,
      note,
      datasets,
    };
    metrics.push(m);
    return m;
  };
  const quarterCash = (p, fields) => {
    const current = cash[p] ?? {},
      value = pick(current, ...fields);
    if (p.endsWith("-03-31")) return value;
    const old = cash[previousQuarter(p)] ?? {},
      a = current.CashBalancesBeginningOfPeriod,
      b = old.CashBalancesBeginningOfPeriod,
      prior = pick(old, ...fields);
    return [value, prior, a, b].every((v) => v != null) && a === b
      ? value - prior
      : null;
  };
  const trailing = (p, fields, count = 4) => {
    const values = [];
    for (let i = 0; i < count; i++) {
      values.push(pick(income[p] ?? {}, ...fields));
      p = previousQuarter(p);
    }
    return strictSum(values);
  };
  let p = latestKey(income);
  if (p) {
    const v = income[p],
      sales = pick(v, "Revenue");
    for (const [key, label, fields] of [
      ["expense_ratio", "營業費用率", ["OperatingExpenses"]],
      ["selling_ratio", "推銷費用率", ["SellingExpenses", "SellingExpense"]],
      [
        "admin_ratio",
        "管理費用率",
        ["AdministrativeExpenses", "AdministrativeExpense"],
      ],
      [
        "research_ratio",
        "研發費用率",
        ["ResearchAndDevelopmentExpenses", "ResearchAndDevelopmentExpense"],
      ],
    ])
      emit(
        key,
        label,
        div(pick(v, ...fields), sales, 100),
        p,
        "%",
        "同季費用 ÷ 營收；來源未拆科目則留空，不能依總費用反推。",
        [I],
      );
    emit(
      "nonoperating_ratio",
      "業外佔稅前淨利比例",
      div(
        pick(v, "TotalNonoperatingIncomeAndExpense"),
        pick(v, "PreTaxIncome"),
        100,
      ),
      p,
      "%",
      "同季業外損益 ÷ 正值稅前淨利；比重偏高需核對一次性項目。",
      [I],
    );
    for (const [key, label, fields] of [
      ["selling_amount", "銷售費用", ["SellingExpenses", "SellingExpense"]],
      [
        "admin_amount",
        "管理費用",
        ["AdministrativeExpenses", "AdministrativeExpense"],
      ],
      [
        "research_amount",
        "研發費用",
        ["ResearchAndDevelopmentExpenses", "ResearchAndDevelopmentExpense"],
      ],
      ["expense_amount", "營業費用", ["OperatingExpenses"]],
      ["pretax_amount", "稅前淨利", ["PreTaxIncome"]],
    ])
      emit(
        key,
        label,
        pick(v, ...fields),
        p,
        "元",
        "單季金額；來源未拆分費用時不反推。",
        [I],
      );
    const parent = incomeRows.filter(
      (r) =>
        r.date === p &&
        r.type === "EquityAttributableToOwnersOfParent" &&
        (r.origin_name ?? "").includes("淨利") &&
        !(r.origin_name ?? "").includes("綜合"),
    );
    emit(
      "parent_net_amount",
      "母公司業主淨利",
      parent.length === 1
        ? pick(v, "EquityAttributableToOwnersOfParent")
        : null,
      p,
      "元",
      "原始科目須明確為母公司業主淨利；不以母公司綜合損益或權益代替。",
      [I],
    );
    for (const [key, label, fields] of [
      ["sales", "營收", ["Revenue"]],
      ["gross", "毛利", ["GrossProfit", "GrossProfitLossFromOperations"]],
      ["operating", "營業利益", ["OperatingIncome", "OperatingIncomeLoss"]],
      ["net", "稅後淨利", ["IncomeAfterTaxes"]],
    ]) {
      emit(
        key + "_amount",
        "單季" + label,
        pick(v, ...fields),
        p,
        "元",
        "來源單季報表金額。",
        [I],
      );
      const total = trailing(p, fields),
        prior = trailing(priorYear(p), fields);
      emit(
        key + "_ttm",
        "近四季" + label,
        total,
        p,
        "元",
        "連續四季金額加總；缺任一季不計。",
        [I],
      );
      emit(
        key + "_ttm_yoy",
        "近四季" + label + "年增率",
        total != null && prior > 0 ? (total / prior - 1) * 100 : null,
        p,
        "%",
        "近四季金額與去年同期四季比較；須連續八季且去年合計為正。",
        [I],
      );
    }
  }
  p = latestKey(balance);
  if (p) {
    const v = balance[p],
      old = balance[previousQuarter(p)] ?? {},
      iv = income[p] ?? {},
      assets = pick(v, "TotalAssets", "Assets"),
      equity = pick(v, "Equity", "TotalEquity"),
      avgAssets = average(assets, pick(old, "TotalAssets", "Assets")),
      avgEquity = average(equity, pick(old, "Equity", "TotalEquity"));
    for (const [key, label, fields] of [
      ["total_assets", "總資產", ["TotalAssets", "Assets"]],
      ["current_assets", "流動資產", ["CurrentAssets"]],
      ["noncurrent_assets", "非流動資產", ["NoncurrentAssets"]],
      ["liabilities", "總負債", ["Liabilities", "TotalLiabilities"]],
      ["equity", "總權益", ["Equity", "TotalEquity"]],
    ])
      emit(
        key,
        label,
        pick(v, ...fields),
        p,
        "元",
        "期末存量；規模增加不直接視為改善。",
        [B],
      );
    emit(
      "equity_ratio",
      "權益比率",
      div(equity, assets, 100),
      p,
      "%",
      "總權益 ÷ 總資產；搭配產業資本需求及負債期限看。",
      [B],
    );
    const sales = pick(iv, "Revenue"),
      cost = pick(iv, "CostOfGoodsSold"),
      net = pick(iv, "IncomeAfterTaxes");
    emit(
      "dupont_net_margin",
      "杜邦同季淨利率",
      div(net, sales, 100),
      p,
      "%",
      "使用與平均資產／平均權益相同季的淨利與營收；不混不同期最新值。",
      [I],
    );
    emit(
      "asset_turnover",
      "單季總資產週轉率",
      div(sales, avgAssets),
      p,
      "次",
      "同季營收 ÷ 相鄰季末平均總資產；未年化。",
      [I, B],
    );
    emit(
      "equity_multiplier",
      "平均資產／平均權益",
      div(avgAssets, avgEquity),
      p,
      "倍",
      "杜邦槓桿因子；槓桿提高不直接視為經營改善。",
      [B],
    );
    const days = daysBetween(p, previousQuarter(p));
    for (const [key, label, fields, flow] of [
      ["inventory", "存貨", ["Inventories", "Inventory"], cost],
      ["receivable", "一般應收帳款", ["AccountsReceivableNet"], sales],
    ]) {
      const rate = div(flow, average(pick(v, ...fields), pick(old, ...fields)));
      emit(
        key + "_turnover",
        "單季" + label + "週轉率",
        rate,
        p,
        "次",
        "同季營收／成本 ÷ 相鄰季末平均存量；未年化。應收僅一般應收帳款，不含票據及關係人。",
        [I, B],
      );
      emit(
        key + "_days",
        label + "週轉天數",
        div(days, rate),
        p,
        "天",
        `本季實際 ${days} 日 ÷ 單季週轉率；不套用 365 日。`,
        [I, B],
      );
    }
    const receivableFields = [
        "AccountsReceivableNet",
        "BillsReceivableNet",
        "AccountsReceivableDuefromRelatedPartiesNet",
      ],
      receivables = [v, old].map((values) =>
        strictSum(receivableFields.map((k) => values[k] ?? null)),
      ),
      totalTurnover = div(sales, average(...receivables));
    emit(
      "receivable_total_turnover",
      "應收帳款及票據週轉",
      totalTurnover,
      p,
      "次",
      "同季營收 ÷ 相鄰季末平均應收帳款、票據及關係人應收合計；三個必要科目缺一則不計。",
      [I, B],
    );
    emit(
      "receivable_total_days",
      "應收帳款及票據收現天數",
      div(90, totalTurnover),
      p,
      "天",
      "參考平台季報口徑：90日 ÷ 含票據及關係人應收的單季週轉率；不是當季實際日數。",
      [I, B],
    );
    emit(
      "inventory_days_reference",
      "存貨週轉天數",
      div(
        90,
        div(
          cost,
          average(
            pick(v, "Inventories", "Inventory"),
            pick(old, "Inventories", "Inventory"),
          ),
        ),
      ),
      p,
      "天",
      "參考平台季報口徑：90日 ÷ 單季存貨週轉率；不是當季實際日數。",
      [I, B],
    );
    const interest = quarterCash(p, ["InterestExpense"]),
      pretax = pick(iv, "PreTaxIncome"),
      tax = pick(iv, "TAX", "IncomeTaxExpense"),
      taxRate = tax != null && pretax > 0 ? tax / pretax : null,
      numerator =
        net != null &&
        interest != null &&
        taxRate != null &&
        taxRate >= 0 &&
        taxRate <= 1
          ? net + interest * (1 - taxRate)
          : null;
    emit(
      "roa_interest_adjusted",
      "單季ROA（稅後利息加回）",
      div(numerator, avgAssets, 100),
      p,
      "%",
      "（同季稅後淨利＋同季利息×（1−有效稅率））÷ 平均總資產；利息須核對累計差分，有效稅率採所得稅／正值稅前淨利且介於0～100%。非正稅前基期需另核對稅率，不假設20%。",
      [I, B, C],
    );
    emit(
      "roe_ttm",
      "近四季ROE",
      div(
        trailing(p, ["IncomeAfterTaxes"]),
        average(
          equity,
          pick(balance[priorYear(p)] ?? {}, "Equity", "TotalEquity"),
        ),
        100,
      ),
      p,
      "%",
      "連續四季本期淨利 ÷ 本季與去年同季期末平均總權益；缺任一季不計。",
      [I, B],
    );
    const contract = pick(v, "CurrentContractLiabilities"),
      prior = pick(balance[priorYear(p)] ?? {}, "CurrentContractLiabilities"),
      previous = pick(old, "CurrentContractLiabilities");
    emit(
      "contract_ratio",
      "流動合約負債佔單季營收",
      div(contract, sales, 100),
      p,
      "%",
      "期末流動合約負債 ÷ 同季營收；不含非流動合約負債。",
      [I, B],
    );
    emit(
      "contract_yoy",
      "流動合約負債年增率",
      contract != null && prior > 0 ? (contract / prior - 1) * 100 : null,
      p,
      "%",
      "與去年同季期末比較；基期非正值不計百分比，增長不直接代表獲利。",
      [B],
    );
    emit(
      "contract_qoq",
      "流動合約負債季增率",
      contract != null && previous > 0 ? (contract / previous - 1) * 100 : null,
      p,
      "%",
      "與前季期末比較；基期非正值不計百分比。",
      [B],
    );
    for (const [key, label, fields] of [
      [
        "short_investments",
        "短期投資",
        ["CurrentFinancialAssetsAtFairvalueThroughProfitOrLoss"],
      ],
      [
        "long_investments",
        "長期投資（權益法）",
        ["InvestmentAccountedForUsingEquityMethod"],
      ],
    ])
      emit(
        key,
        label,
        pick(v, ...fields),
        p,
        "元",
        "採來源明確辨識的金融資產／權益法投資科目，不把缺科目當零。",
        [B],
      );
    const old4 = balance[priorYear(p, 4)] ?? {},
      invested = [v, old4].flatMap((values) => [
        pick(values, "InvestmentAccountedForUsingEquityMethod"),
        pick(
          values,
          "PropertyPlantAndEquipment",
          "PropertyAndPlantAndEquipment",
        ),
      ]),
      profit16 = trailing(p, ["IncomeAfterTaxes"], 16),
      increase = invested.every((x) => x != null)
        ? invested[0] + invested[1] - invested[2] - invested[3]
        : null,
      m = emit(
        "reinvestment_ratio",
        "盈餘再投資比率",
        div(increase, profit16, 100),
        p,
        "%",
        "（當季權益法長期投資＋固定資產−四年前同季兩項）÷ 近16季稅後淨利；須16季連續且淨利合計為正。",
        [I, B],
      );
    if (profit16 != null && profit16 <= 0) {
      m.missing_reason = "non_positive_profit";
      emit(
        "reinvestment_profit_base",
        "近16季稅後淨利合計",
        profit16,
        p,
        "元",
        "淨利合計非正，因此盈再率不計百分比；不能說只是缺資料。",
        [I],
      );
    }
    for (const [key, label, fields] of [
      ["cash_balance", "現金及約當現金", ["CashAndCashEquivalents"]],
      ["inventory_amount", "存貨", ["Inventories", "Inventory"]],
      [
        "fixed_assets",
        "固定資產",
        ["PropertyPlantAndEquipment", "PropertyAndPlantAndEquipment"],
      ],
      ["short_borrowings", "短期借款", ["ShorttermBorrowings"]],
      ["current_liabilities", "流動負債", ["CurrentLiabilities"]],
      ["long_liabilities", "長期負債（長期借款）", ["LongtermBorrowings"]],
      [
        "short_notes_payable",
        "應付短期票券",
        ["ShorttermNotesAndBillsPayable"],
      ],
      ["advance_receipts", "預收款項", ["AdvanceReceipts"]],
      [
        "current_long_debt",
        "一年內到期長期負債",
        ["CurrentPortionOfLongtermDebt"],
      ],
      ["receivable_amount", "應收帳款及票據", receivableFields],
    ])
      emit(
        key,
        label,
        key === "receivable_amount"
          ? strictSum(fields.map((k) => v[k] ?? null))
          : pick(v, ...fields),
        p,
        "元",
        "來源期末金額；應收款合計必須具一般應收、票據及關係人各科目。",
        [B],
      );
    emit(
      "payable_amount",
      "應付帳款及票據",
      strictSum(
        [
          "AccountsPayable",
          "AccountsPayableToRelatedParties",
          "NotesPayable",
        ].map((k) => v[k] ?? null),
      ),
      p,
      "元",
      "一般應付、關係人應付及應付票據合計；缺科目不假設零。",
      [B],
    );
  }
  p = latestKey(cash);
  if (p) {
    const v = cash[p];
    emit(
      "financing_cash",
      "籌資活動淨現金流",
      pick(
        v,
        "CashFlowsProvidedFromFinancingActivities",
        "CashFlowsFromFinancingActivities",
      ),
      p,
      "元",
      "來源同一報表期間；流入可能是借款，流出可能是還款或配息，不單看正負判好壞。",
      [C],
    );
    const interest = pick(v, "InterestExpense"),
      pretax = pick(v, "NetIncomeBeforeTax");
    emit(
      "interest_coverage",
      "利息保障倍數",
      div(
        interest != null && pretax != null ? interest + pretax : null,
        interest,
      ),
      p,
      "倍",
      "同一現金流報表期間（稅前淨利＋利息費用）÷ 正值利息費用；零或缺值不當成無限安全。",
      [C],
    );
    const op = quarterCash(p, ["CashFlowsFromOperatingActivities"]);
    for (const [key, label, fields] of [
      [
        "operating_cash_quarter",
        "單季營業現金流",
        ["CashFlowsFromOperatingActivities"],
      ],
      [
        "investing_cash_quarter",
        "單季投資現金流",
        [
          "CashProvidedByInvestingActivities",
          "CashFlowsFromInvestingActivities",
        ],
      ],
      [
        "financing_cash_quarter",
        "單季融資現金流",
        [
          "CashFlowsProvidedFromFinancingActivities",
          "CashFlowsFromFinancingActivities",
        ],
      ],
      ["depreciation_quarter", "單季折舊", ["Depreciation"]],
      ["amortization_quarter", "單季攤銷", ["AmortizationExpense"]],
      ["cash_change_quarter", "單季淨現金流", ["CashBalancesIncrease"]],
    ])
      emit(
        key,
        label,
        quarterCash(p, fields),
        p,
        "元",
        "第一季使用來源值；其餘季度須有前季且年初現金餘額相同，才將年度累計差分成單季。",
        [C],
      );
    const bv = balance[p] ?? {};
    emit(
      "cash_current_debt_ratio",
      "營業現金對流動負債比",
      div(op, pick(bv, "CurrentLiabilities"), 100),
      p,
      "%",
      "已核對差分的單季營業現金流 ÷ 同季期末流動負債；不是累計流量。",
      [C, B],
    );
    emit(
      "cash_debt_ratio",
      "營業現金對負債比",
      div(op, pick(bv, "Liabilities", "TotalLiabilities"), 100),
      p,
      "%",
      "已核對差分的單季營業現金流 ÷ 同季期末總負債。",
      [C, B],
    );
    emit(
      "cash_profit_quarter_ratio",
      "單季營業現金對稅後淨利比",
      div(op, pick(income[p] ?? {}, "IncomeAfterTaxes"), 100),
      p,
      "%",
      "已核對差分的單季營業現金流 ÷ 同季正值本期淨利；淨利非正值不計。",
      [C, I],
    );
    const equipment = (q) =>
      cashRows.filter(
        (r) =>
          r.date === q &&
          r.type === "PropertyAndPlantAndEquipment" &&
          ["取得不動產", "購置不動產", "購置固定資產"].some((word) =>
            (r.origin_name ?? "").includes(word),
          ),
      ).length === 1 &&
      pick(cash[q] ?? {}, "PropertyAndPlantAndEquipment") != null;
    const outflow =
        equipment(p) && (p.endsWith("-03-31") || equipment(previousQuarter(p)))
          ? quarterCash(p, ["PropertyAndPlantAndEquipment"])
          : null,
      capex = outflow != null && outflow <= 0 ? -outflow : null;
    emit(
      "capex_quarter",
      "單季設備取得支出",
      capex,
      p,
      "元",
      "原始取得設備科目核對後差分並將支出轉正；不包含未辨識的其他資本支出。",
      [C],
    );
    emit(
      "free_cash_quarter",
      "單季自由現金流參考",
      op != null && capex != null ? op - capex : null,
      p,
      "元",
      "同季營業現金流減已辨識設備取得支出；資本支出涵蓋不完整時僅供參考。",
      [C],
    );
  }
  p = Object.keys(cash)
    .filter((p) => p.endsWith("-12-31"))
    .sort()
    .at(-1);
  if (p) {
    const net = strictSum(
      ["03-31", "06-30", "09-30", "12-31"].map((q) =>
        pick(income[p.slice(0, 4) + "-" + q] ?? {}, "IncomeAfterTaxes"),
      ),
    );
    emit(
      "cash_profit_ratio",
      "年度營業現金流對淨利比",
      div(pick(cash[p], "CashFlowsFromOperatingActivities"), net, 100),
      p,
      "%",
      "完整年末營業現金流 ÷ 同年四季本期淨利；淨利非正值、缺季度均不計；不以最新季累計除以單季淨利。",
      [I, C],
    );
  } else if (Object.keys(cash).length)
    emit(
      "cash_profit_ratio",
      "年度營業現金流對淨利比",
      null,
      null,
      "%",
      "需要年末現金流及同年完整四季本期淨利。",
      [I, C],
    );
  p = dividends
    .map((r) => r.date)
    .sort()
    .at(-1);
  if (p) {
    const rows = dividends.filter((r) => r.date === p);
    for (const [key, label, fields] of [
      [
        "cash_dividend",
        "最近事件現金股利",
        ["CashEarningsDistribution", "CashStatutorySurplus"],
      ],
      [
        "stock_dividend",
        "最近事件股票股利",
        ["StockEarningsDistribution", "StockStatutorySurplus"],
      ],
    ])
      emit(
        key,
        label,
        rows.length === 1
          ? strictSum(fields.map((k) => num(rows[0][k])))
          : null,
        p,
        "元／股",
        "只呈現最近來源單一配息事件；同日多筆需核對，不直接相加為全年股利。",
        ["TaiwanStockDividend"],
      );
  }
}
