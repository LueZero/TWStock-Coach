import { readFileSync } from "node:fs";
import {
  num,
  pick,
  div,
  average,
  latestKey,
  previousQuarter,
  priorYear,
  daysBetween,
  taipeiDay,
  canonical,
  digest,
  validDate,
  now,
  fail,
} from "./lib.js";
import { extendMetrics } from "./financial-metrics.js";
import { rows, transaction } from "./db.js";
const I = "TaiwanStockFinancialStatements",
  B = "TaiwanStockBalanceSheet",
  C = "TaiwanStockCashFlowsStatement",
  R = "TaiwanStockMonthRevenue",
  P = "TaiwanStockPER",
  D = "TaiwanStockDividend";
export const DATASETS = {
  [R]: "月營收",
  [I]: "綜合損益表",
  [B]: "資產負債表",
  [C]: "現金流量表",
  [P]: "本益比／股價淨值比／殖利率",
  [D]: "股利政策",
};
const definitions = JSON.parse(
  readFileSync(new URL("./financial-catalog.json", import.meta.url), "utf8"),
);
export function buildCatalog(metrics, statements, dividends) {
  const by = Object.fromEntries(metrics.map((m) => [m.key, m]));
  return {
    version: 1,
    groups: definitions.map((g) => ({
      ...g,
      pages: g.pages.map((d) => {
        const usable = d.keys.filter((k) => by[k]?.value != null).length;
        let rs = statements[d.report]?.rows ?? [];
        if (d.fields) rs = rs.filter((r) => d.fields.includes(r.key));
        const evidence =
          usable > 0 ||
          rs.some((r) => r.value != null) ||
          (d.kind === "dividends" && dividends.length > 0);
        return {
          ...d,
          available_metrics: usable,
          metric_count: d.keys.length,
          status: d.requires
            ? "dependency_missing"
            : d.kind === "documents"
              ? "reference"
              : evidence && usable === d.keys.length
                ? "available"
                : evidence
                  ? "partial"
                  : "no_data",
        };
      }),
    })),
    color_policy: {
      good: "紅：改善／強勢",
      bad: "綠：衰退",
      watch: "黃：需留意",
      neutral: "背景／不可單憑高低判斷",
      unknown: "缺資料；不視為零",
    },
  };
}
export function assess(m, history) {
  const { key: k, value: v } = m;
  const a = (tone, label, reason) => ({ tone, label, reason });
  if (v == null)
    return m.missing_reason === "non_positive_profit"
      ? a(
          "bad",
          "近16季淨利合計非正",
          "盈再率分母虧損或為零，因此百分比不成立；已有淨利資料，不能說只是缺資料。",
        )
      : a("unknown", "資料不足", "缺資料不視為零，也不判斷好壞。");
  if (k === "reinvestment_ratio")
    return a(
      v >= 80 ? "watch" : "neutral",
      v >= 80 ? "投資增量需留意" : "核對投資與獲利",
      "依四年投資存量變化與淨利比較；80%為研究提醒，非越低越好，須核對資產重分類、減損與併購。",
    );
  if (k === "interest_coverage")
    return a(
      v < 1 ? "bad" : v < 3 ? "watch" : "neutral",
      v < 1 ? "利息覆蓋不足" : v < 3 ? "覆蓋需留意" : "具帳面利息覆蓋",
      "小於1倍代表本期間息前獲利不足以涵蓋利息；1～3倍為研究用提醒門檻，仍需核對產業、借款到期與現金。",
    );
  if (k === "nonoperating_ratio")
    return a(
      v >= 50 ? "watch" : "neutral",
      v >= 50 ? "業外比重偏高" : "核對獲利組成",
      "50%為研究用提醒門檻；業外正值不等於可持續獲利，負值可能是匯損或投資損失。",
    );
  if (["cash_profit_ratio", "cash_profit_quarter_ratio"].includes(k))
    return a(
      v < 0 ? "bad" : v < 100 ? "watch" : "neutral",
      v < 0
        ? "獲利未轉現金"
        : v < 100
          ? "現金低於帳面淨利"
          : "年度現金覆蓋淨利",
      "100%代表同期間營業現金流等於帳面淨利；應收回收、存貨、稅款及一次性項目都會影響，並非買入條件。",
    );
  if (
    [
      "inventory_days",
      "inventory_days_reference",
      "receivable_days",
      "receivable_total_days",
      "asset_turnover",
      "inventory_turnover",
      "receivable_turnover",
      "receivable_total_turnover",
    ].includes(k)
  ) {
    const prev = m.comparison?.value,
      delta = m.comparison?.difference;
    if (prev > 0 && v > 0 && delta != null) {
      const improved = k.includes("_days") ? delta < 0 : delta > 0;
      return a(
        improved ? "good" : delta !== 0 ? "bad" : "neutral",
        improved
          ? "較去年同季效率改善"
          : delta !== 0
            ? "較去年同季效率下降"
            : "較去年同季持平",
        "只比較相同單季口徑；天數下降／週轉上升標紅。仍需核對營收、清庫存、認列與產業季節性。",
      );
    }
  }
  if (
    [
      "expense_ratio",
      "selling_ratio",
      "admin_ratio",
      "research_ratio",
      "contract_ratio",
      "contract_yoy",
      "equity_multiplier",
    ].includes(k)
  )
    return a(
      k === "contract_yoy" && v < 0 ? "watch" : "neutral",
      "需要業務背景",
      m.note + " 高低或增減本身不是好壞判斷。",
    );
  if (["per", "pbr", "dividend_yield"].includes(k)) {
    const vs = history.map((p) => p.value).filter((v) => v > 0);
    if (vs.length < 30)
      return a(
        "neutral",
        "需要歷史對照",
        "至少 30 筆同檔估值才能比較歷史位置；不以固定倍數判定便宜。",
      );
    const p = (vs.filter((x) => x < v).length / vs.length) * 100;
    return a(
      p >= 80 && k !== "dividend_yield" ? "watch" : "neutral",
      `歷史位置 ${Math.round(p)}%`,
      `在目前已取得的 ${vs.length} 筆正值樣本中比較；高估值可能反映成長，低估值也可能反映風險。殖利率不是保證收益。`,
    );
  }
  if (
    [
      "sales_yoy",
      "gross_yoy",
      "operating_yoy",
      "net_yoy",
      "sales_ttm_yoy",
      "gross_ttm_yoy",
      "operating_ttm_yoy",
      "net_ttm_yoy",
    ].includes(k)
  )
    return a(
      v > 0 ? "good" : v < 0 ? "bad" : "neutral",
      v > 0 ? "年增為正" : v < 0 ? "年增為負" : "與去年同季持平",
      "以去年同季正基期比較；需同時看原始金額、連續季度及一次性收益。",
    );
  if (["current_ratio", "quick_ratio"].includes(k))
    return a(
      v < 100 ? "watch" : "neutral",
      v < 100 ? "需檢查短期償債" : "需核對資產品質",
      "帳面比率不等於現金；留意應收款、存貨、借款期限及產業特性，不用單一門檻判公司安全。",
    );
  const notes = {
    revenue_yoy: "年增為正表示比去年同月成長；還需核對連續月份與獲利。",
    revenue_mom: "月增率容易受季節與工作日影響，不能單獨判斷好壞。",
    eps: "正 EPS 表示該季獲利，負 EPS 表示虧損；還需比較去年同季與股數基準。",
    operating_cash:
      "正值為營業現金淨流入；負值需核對應收款、存貨及季節性，報表可能為年度累計。",
    free_cash:
      "只扣除已辨識設備支出的參考值；負值可能來自擴產，不能直接判定公司不好。",
  };
  if (notes[k])
    return a(
      v > 0
        ? "good"
        : ["eps", "revenue_yoy"].includes(k) && v < 0
          ? "bad"
          : "watch",
      v > 0 ? "正向觀察" : "需留意",
      notes[k],
    );
  if (
    [
      "gross_margin",
      "operating_margin",
      "net_margin",
      "pretax_margin",
      "dupont_net_margin",
      "roe_quarter",
      "roa_quarter",
      "roa_interest_adjusted",
      "roe_ttm",
    ].includes(k)
  ) {
    if (v < 0)
      return a(
        "bad",
        "本期為負",
        "相應獲利率為負，需核對營運原因與是否為一次性因素。",
      );
    const prev = history.find((p) => p.period === priorYear(m.period))?.value;
    if (prev != null) {
      const delta = v - prev;
      return a(
        delta > 0 ? "good" : delta < 0 ? "bad" : "neutral",
        `年變化 ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} 個百分點`,
        "與去年同季比較；改善用紅色，下降用綠色。正值不代表股價一定上漲。",
      );
    }
  }
  return a(
    "neutral",
    "需背景判讀",
    m.note || "需要產業、用途與歷史背景，不使用通用門檻判好壞。",
  );
}
export function summarize(data, cutoff = taipeiDay(), withHistory = true) {
  const day = cutoff.length === 10 ? cutoff : taipeiDay(cutoff),
    items = (d) => (data[d] ?? []).filter((r) => r.date <= day),
    statements = (d) => {
      const result = {};
      for (const r of items(d)) (result[r.date] ??= {})[r.type] = num(r.value);
      return result;
    },
    income = statements(I),
    balance = statements(B),
    cash = statements(C),
    metrics = [];
  const metric = (key, label, value, period, unit, note) => {
    const datasets = key.startsWith("revenue")
      ? [R]
      : [
            "eps",
            "gross_margin",
            "operating_margin",
            "net_margin",
            "pretax_margin",
            "sales_yoy",
            "gross_yoy",
            "operating_yoy",
            "net_yoy",
          ].includes(key)
        ? [I]
        : ["roe_quarter", "roa_quarter"].includes(key)
          ? [B, I]
          : [
                "debt_ratio",
                "current_ratio",
                "quick_ratio",
                "long_capital_ratio",
              ].includes(key)
            ? [B]
            : ["per", "pbr", "dividend_yield"].includes(key)
              ? [P]
              : [C];
    metrics.push({
      key,
      label,
      value: value ?? null,
      period,
      unit,
      note,
      datasets,
    });
  };
  const revenue = {};
  for (const r of items(R))
    if (r.revenue_year && r.revenue_month)
      revenue[
        `${String(r.revenue_year).padStart(4, "0")}-${String(r.revenue_month).padStart(2, "0")}`
      ] = num(r.revenue);
  const revPeriod = latestKey(revenue);
  let revYoy = null,
    eps = null;
  if (revPeriod) {
    const current = revenue[revPeriod],
      prior = revenue[priorYear(revPeriod)],
      previous =
        revenue[
          new Date(Date.parse(revPeriod + "-01T00:00:00Z") - 86400000)
            .toISOString()
            .slice(0, 7)
        ];
    revYoy = current != null && prior > 0 ? (current / prior - 1) * 100 : null;
    metric(
      "revenue",
      "月營收",
      current,
      revPeriod,
      "元",
      "新臺幣；以來源營收年月為準",
    );
    metric(
      "revenue_yoy",
      "營收年增率",
      revYoy,
      revPeriod,
      "%",
      "與去年同月比較，不足一年資料則留空",
    );
    metric(
      "revenue_mom",
      "營收月增率",
      current != null && previous > 0 ? (current / previous - 1) * 100 : null,
      revPeriod,
      "%",
      "與前一個月份比較，留意季節性",
    );
  }
  const ip = latestKey(income);
  if (ip) {
    const v = income[ip],
      sales = pick(v, "Revenue");
    eps = pick(v, "EPS");
    metric(
      "eps",
      "單季每股盈餘",
      eps,
      ip,
      "元／股",
      "來源單季 EPS；配股／分割可能改變股數基準，不直接相加為 TTM",
    );
    for (const [key, label, fields, note] of [
      [
        "gross_margin",
        "毛利率",
        ["GrossProfit", "GrossProfitLossFromOperations"],
        "同一期毛利 ÷ 營收；無法辨識的科目留空",
      ],
      [
        "operating_margin",
        "營業利益率",
        ["OperatingIncome", "OperatingIncomeLoss"],
        "同一期營業利益 ÷ 營收",
      ],
      [
        "net_margin",
        "稅後淨利率",
        ["IncomeAfterTaxes"],
        "同一期本期淨利 ÷ 營收",
      ],
      [
        "pretax_margin",
        "稅前淨利率",
        ["PreTaxIncome"],
        "同一期稅前淨利 ÷ 營收",
      ],
    ])
      metric(key, label, div(pick(v, ...fields), sales, 100), ip, "%", note);
    for (const [key, label, fields] of [
      ["sales_yoy", "單季營收年增率", ["Revenue"]],
      [
        "gross_yoy",
        "單季毛利年增率",
        ["GrossProfit", "GrossProfitLossFromOperations"],
      ],
      [
        "operating_yoy",
        "單季營業利益年增率",
        ["OperatingIncome", "OperatingIncomeLoss"],
      ],
      ["net_yoy", "單季稅後淨利年增率", ["IncomeAfterTaxes"]],
    ]) {
      const curr = pick(v, ...fields),
        prev = pick(income[priorYear(ip)] ?? {}, ...fields);
      metric(
        key,
        label,
        curr != null && prev > 0 ? (curr / prev - 1) * 100 : null,
        ip,
        "%",
        "與去年同季比較；去年基期為零、負值或缺漏時不計百分比，需回看報表金額。",
      );
    }
  }
  const bp = latestKey(balance);
  if (bp) {
    const v = balance[bp],
      assets = pick(v, "TotalAssets", "Assets"),
      equity = pick(v, "Equity", "TotalEquity"),
      old = balance[previousQuarter(bp)] ?? {},
      net = pick(income[bp] ?? {}, "IncomeAfterTaxes"),
      ca = pick(v, "CurrentAssets"),
      cl = pick(v, "CurrentLiabilities"),
      inv = pick(v, "Inventories", "Inventory"),
      pre = pick(v, "Prepayments"),
      long = pick(v, "NoncurrentLiabilities");
    metric(
      "debt_ratio",
      "負債比率",
      div(pick(v, "TotalLiabilities", "Liabilities"), assets, 100),
      bp,
      "%",
      "總負債 ÷ 總資產；不同產業需分別解讀",
    );
    metric(
      "current_ratio",
      "流動比率",
      div(ca, cl, 100),
      bp,
      "%",
      "流動資產 ÷ 流動負債；100%代表帳面資產等於短期負債，不代表保證能償還。",
    );
    metric(
      "quick_ratio",
      "速動比率",
      div(
        [ca, inv, pre].every((x) => x != null) ? ca - inv - pre : null,
        cl,
        100,
      ),
      bp,
      "%",
      "（流動資產 − 存貨 − 預付款項）÷ 流動負債；任一必要科目缺漏則留空，不假設為零。",
    );
    metric(
      "long_capital_ratio",
      "長期資金占固定資產比率",
      div(
        long != null && equity != null ? long + equity : null,
        pick(v, "PropertyPlantAndEquipment", "PropertyAndPlantAndEquipment"),
        100,
      ),
      bp,
      "%",
      "（總權益＋非流動負債）÷ 不動產、廠房及設備；不是非流動資產比率，無可辨識設備科目則留空。",
    );
    metric(
      "roe_quarter",
      "單季權益報酬率",
      div(net, average(equity, pick(old, "Equity", "TotalEquity")), 100),
      bp,
      "%",
      "同季本期淨利 ÷ 相鄰季末平均總權益；未年化，非母公司業主 ROE",
    );
    metric(
      "roa_quarter",
      "單季資產報酬率",
      div(net, average(assets, pick(old, "TotalAssets", "Assets")), 100),
      bp,
      "%",
      "同季本期淨利 ÷ 相鄰季末平均總資產；未年化，不含利息加回，與其他平台口徑可能不同。",
    );
  }
  const cp = latestKey(cash);
  if (cp) {
    const v = cash[cp],
      oc = pick(v, "CashFlowsFromOperatingActivities"),
      acq = items(C).filter(
        (r) =>
          r.date === cp &&
          r.type === "PropertyAndPlantAndEquipment" &&
          ["取得不動產", "購置不動產", "購置固定資產"].some((w) =>
            (r.origin_name ?? "").includes(w),
          ),
      ),
      out = acq.length === 1 ? num(acq[0].value) : null,
      capex = out != null && out <= 0 ? -out : null;
    metric(
      "operating_cash",
      "營業活動淨現金流",
      oc,
      cp,
      "元",
      "來源報表值；可能為年度累計，不當成單季或跨季相加",
    );
    metric(
      "investing_cash",
      "投資活動淨現金流",
      pick(
        v,
        "CashProvidedByInvestingActivities",
        "CashFlowsFromInvestingActivities",
      ),
      cp,
      "元",
      "不以全部投資活動現金流冒充資本支出；自由現金流需另核對科目",
    );
    metric(
      "capex",
      "取得設備等資本支出",
      capex,
      cp,
      "元",
      "只辨識已核對的取得不動產、廠房及設備現金流科目；支出轉正值",
    );
    metric(
      "free_cash",
      "自由現金流參考",
      oc != null && capex != null ? oc - capex : null,
      cp,
      "元",
      "同一期營業現金流減已辨識設備資本支出；非完整所有資本支出，可能為年度累計",
    );
  }
  const per = items(P).sort((a, b) => a.date.localeCompare(b.date));
  if (per.length)
    for (const [key, label, field, unit] of [
      ["per", "本益比", "PER", "倍"],
      ["pbr", "股價淨值比", "PBR", "倍"],
      ["dividend_yield", "殖利率", "dividend_yield", "%"],
    ])
      metric(
        key,
        label,
        num(per.at(-1)[field]) > 0 ? num(per.at(-1)[field]) : null,
        per.at(-1).date,
        unit,
        "直接使用來源估值；零值不視為便宜，須搭配產業及成長性",
      );
  extendMetrics(income, balance, cash, items(D), metrics, items(C), items(I));
  const fresh =
      revPeriod &&
      daysBetween(day, revPeriod + "-01") <= 100 &&
      ip &&
      daysBetween(day, ip) <= 200,
    result = {
      metrics,
      revenue_history: Object.entries(revenue)
        .sort()
        .map(([period, value]) => ({ period, value })),
      gate:
        revYoy == null || eps == null || !fresh
          ? "unknown"
          : revYoy > 0 && eps > 0
            ? "pass"
            : "caution",
      gate_note:
        "研究用基本面篩選：最近月營收年增 > 0、最近單季 EPS > 0，且資料未過期；不等於完整財務健檢。",
      statement_periods: {
        income: ip ?? null,
        balance: bp ?? null,
        cash: cp ?? null,
      },
    };
  if (withHistory) {
    result.statements = {};
    for (const [d, label] of [
      [I, "綜合損益表"],
      [B, "資產負債表"],
      [C, "現金流量表"],
    ]) {
      const rs = items(d);
      result.statements[d] = {
        label,
        periods: [...new Set(rs.map((r) => r.date))].sort().reverse(),
        rows: rs.map((r) => ({
          period: r.date,
          key: r.type,
          label: r.origin_name || r.type,
          value: num(r.value),
          unit: r.type?.endsWith("_per")
            ? "%"
            : r.type === "EPS"
              ? "元／股"
              : "元",
        })),
      };
    }
    const series = {},
      periods = [
        ...new Set(
          Object.entries(data)
            .filter(([d]) => d in DATASETS && ![P, D].includes(d))
            .flatMap(([, rs]) =>
              rs.filter((r) => r.date <= day).map((r) => r.date),
            ),
        ),
      ].sort();
    for (const p of periods)
      for (const m of summarize(data, p, false).metrics)
        if (m.value != null)
          (series[m.key] ??= {})[m.period] = {
            period: m.period,
            value: m.value,
          };
    for (const [k, f] of [
      ["per", "PER"],
      ["pbr", "PBR"],
      ["dividend_yield", "dividend_yield"],
    ])
      series[k] = Object.fromEntries(
        per
          .filter((r) => num(r[f]) > 0)
          .map((r) => [r.date, { period: r.date, value: num(r[f]) }]),
      );
    result.history = Object.fromEntries(
      Object.entries(series).map(([k, vs]) => [k, Object.values(vs)]),
    );
    for (const m of metrics) {
      const h = result.history[m.key] ?? [],
        p = m.period ? priorYear(m.period) : null,
        prev = h.find((x) => x.period === p)?.value ?? null;
      m.comparison = {
        basis: "same_period_previous_year",
        period: p,
        value: prev,
        difference: m.value != null && prev != null ? m.value - prev : null,
        unit: m.unit === "%" ? "百分點" : m.unit,
      };
      m.assessment = assess(m, h);
    }
    result.dividends = items(D).sort((a, b) => b.date.localeCompare(a.date));
    result.catalog = buildCatalog(metrics, result.statements, result.dividends);
    result.analysis_contract = {
      version: 1,
      missing_is_zero: false,
      availability_basis: "platform_first_observation",
      period_basis:
        "metric-specific; never mix quarterly income with unverified cumulative cash flow",
      rules:
        "assessment is an observation, not an investment recommendation or issuer score",
    };
  }
  return result;
}
export async function saveSnapshot(
  market,
  symbol,
  dataset,
  data,
  source = "finmind",
  receivedAt = now(),
) {
  for (const r of data)
    if (r.stock_id !== symbol || validDate(r.date) > taipeiDay())
      fail("來源股票或日期不符");
  const sorted = [...data].sort((a, b) =>
      canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0,
    ),
    hash = digest({ source, rows: sorted });
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(78241004)");
    const old = (
      await client.query(
        "SELECT * FROM fundamental_snapshots WHERE market=$1 AND symbol=$2 AND dataset=$3 ORDER BY id DESC LIMIT 1",
        [market, symbol, dataset],
      )
    ).rows[0];
    // Normalized equality preserves existing revisions across JSON serializers.
    if (
      old?.digest === hash ||
      (old?.source === source &&
        canonical(
          [...old.data].sort((a, b) =>
            canonical(a) < canonical(b)
              ? -1
              : canonical(a) > canonical(b)
                ? 1
                : 0,
          ),
        ) === canonical(sorted))
    )
      return old;
    return (
      await client.query(
        "INSERT INTO fundamental_snapshots(market,symbol,dataset,source,received_at,digest,revision,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [
          market,
          symbol,
          dataset,
          source,
          receivedAt,
          hash,
          (old?.revision ?? 0) + 1,
          JSON.stringify(sorted),
        ],
      )
    ).rows[0];
  });
}
export async function snapshots(
  market,
  symbol,
  cutoff = now(),
  datasets = Object.keys(DATASETS),
) {
  return rows(
    "SELECT * FROM fundamental_snapshots WHERE market=$1 AND symbol=$2 AND received_at<=$3 AND dataset=ANY($4) ORDER BY id DESC",
    [market, symbol, cutoff, datasets],
  );
}
export async function view(
  market,
  symbol,
  cutoff = now(),
  includeRaw = false,
  fiscalCutoff = null,
) {
  const all = await snapshots(market, symbol, cutoff),
    selected = {};
  for (const s of all) selected[s.dataset] ??= s;
  const fiscal =
      fiscalCutoff && fiscalCutoff < taipeiDay(cutoff)
        ? fiscalCutoff
        : taipeiDay(cutoff),
    result = summarize(
      Object.fromEntries(Object.entries(selected).map(([d, s]) => [d, s.data])),
      fiscal,
    );
  Object.assign(result, {
    as_of: cutoff,
    availability_basis: "platform_first_observation",
    note: "來源未提供可驗證公告時間，保守以平台取得時間決定歷史可用性；報表日期不是公告日期。",
    coverage: Object.entries(DATASETS).map(([dataset, label]) => ({
      dataset,
      label,
      status: selected[dataset]?.data.length ? "available" : "no_data",
      received_at: selected[dataset]?.received_at ?? null,
      revision: selected[dataset]?.revision ?? null,
      snapshot_id: selected[dataset]?.id ?? null,
      source: selected[dataset]?.source ?? null,
    })),
  });
  if (includeRaw) {
    result.raw_datasets = Object.fromEntries(
      Object.entries(selected).map(([d, s]) => [d, s.data]),
    );
    result.revision_history = all.map((s) => ({
      id: s.id,
      dataset: s.dataset,
      revision: s.revision,
      received_at: s.received_at,
      digest: s.digest,
    }));
  }
  return result;
}
