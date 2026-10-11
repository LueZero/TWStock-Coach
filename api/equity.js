import { num, sum, median, daysBetween, taipeiDay, now } from "./lib.js";
import { snapshots } from "./fundamentals.js";
import { rows as queryRows } from "./db.js";
export const DATASETS = {
  CompanyProfile: ["公司基本資料", null],
  TaiwanStockInstitutionalInvestorsBuySell: ["三大法人買賣超", null],
  TaiwanStockShareholding: ["外資持股", null],
  TaiwanStockHoldingSharesPer: [
    "股東持股分級",
    "集保最新免費；歷史資料需 Backer／Sponsor",
  ],
  TaiwanStockBrokerDailyConcentration: ["前15大分點淨流向", "Sponsor"],
  TaiwanStockTradingDailyReport: ["券商分點", "Sponsor"],
  TaiwanStockActiveETFHolding: ["指定主動ETF持股", "Sponsor＋ETF_WATCHLIST"],
  AnalystTargetReport: ["法人目標價", "具授權的研究報告來源"],
  FundHoldingsReport: ["ETF／基金持股", "具授權的持股揭露來源"],
};
export function replaceObservationWindow(
  previous,
  items,
  start,
  end,
  codes = null,
) {
  return previous
    .filter(
      (r) =>
        !(
          start <= r.date &&
          r.date <= end &&
          (!codes || codes.includes(r.fund_code))
        ),
    )
    .concat(items);
}
export function chipSummary(data, start, end, market = "TWSE") {
  const rows = (d) =>
      (data[d] ?? []).filter((r) => start <= r.date && r.date <= end),
    metrics = [],
    history = {},
    details = {};
  const add = (key, label, points, unit, note, directional = false) => {
    points.sort((a, b) => a.period.localeCompare(b.period));
    history[key] = points;
    const value = points.length
      ? directional
        ? sum(points.map((p) => p.value))
        : points.at(-1).value
      : null;
    if (directional && points.length)
      note += ` 卡片為區間已取得${points.length}日合計，趨勢為每日值；不假設缺漏日為零。`;
    const tone =
        value == null
          ? "unknown"
          : directional
            ? value > 0
              ? "good"
              : value < 0
                ? "bad"
                : "neutral"
            : "neutral",
      datasets = ["foreign", "trust", "dealer"].includes(key)
        ? ["TaiwanStockInstitutionalInvestorsBuySell"]
        : key === "main_net"
          ? ["TaiwanStockBrokerDailyConcentration"]
          : key === "branches"
            ? ["TaiwanStockTradingDailyReport"]
            : key === "foreign_holding"
              ? ["TaiwanStockShareholding"]
              : ["TaiwanStockHoldingSharesPer"];
    metrics.push({
      key,
      label,
      value,
      unit,
      datasets,
      period: points.at(-1)?.period ?? null,
      note,
      assessment: {
        tone,
        label:
          value == null
            ? "資料不足"
            : directional && value > 0
              ? "淨買超"
              : directional && value < 0
                ? "淨賣超"
                : "觀察值",
        reason: note,
      },
    });
  };
  const grouped = {};
  for (const r of rows("TaiwanStockInstitutionalInvestorsBuySell"))
    (grouped[r.date] ??= {})[r.name] =
      num(r.buy) != null && num(r.sell) != null
        ? num(r.buy) - num(r.sell)
        : null;
  const net = (v, g, date) => {
    // FinMind uses Foreign_Dealer_Self, not Foreign_Dealer. Before the
    // market's split date, Foreign_Investor already includes both groups.
    const foreignSplit = market === "TPEX" ? "2018-01-15" : "2017-12-18";
    const names =
        g === "foreign"
          ? date < foreignSplit
            ? ["Foreign_Investor"]
            : ["Foreign_Investor", "Foreign_Dealer_Self"]
          : g === "trust"
            ? ["Investment_Trust"]
            : "Dealer" in v
              ? ["Dealer"]
              : ["Dealer_self", "Dealer_Hedging"],
      found = names.map((n) => v[n]);
    return found.every((value) => value != null) ? sum(found) : null;
  };
  for (const [g, label] of [
    ["foreign", "外資淨買賣超"],
    ["trust", "投信淨買賣超"],
    ["dealer", "自營商淨買賣超"],
  ])
    add(
      g,
      "區間" + label,
      Object.entries(grouped)
        .filter(([period, v]) => net(v, g, period) != null)
        .map(([period, v]) => ({ period, value: net(v, g, period) })),
      "股",
      "買進減賣出；正數是淨買超，負數是淨賣超。這是流量，不是持股存量。",
      true,
    );
  details.institutions = Object.entries(grouped)
    .sort()
    .reverse()
    .map(([date, v]) => ({
      date,
      foreign: net(v, "foreign", date),
      trust: net(v, "trust", date),
      dealer: net(v, "dealer", date),
    }));
  add(
    "main_net",
    "區間前15大分點淨流向",
    rows("TaiwanStockBrokerDailyConcentration")
      .filter(
        (r) => num(r.top_buy_volume) != null && num(r.top_sell_volume) != null,
      )
      .map((r) => ({
        period: r.date,
        value: num(r.top_buy_volume) - num(r.top_sell_volume),
      })),
    "股",
    "每日前15大淨買超股數減前15大淨賣超股數再合計；是分點集中度代理，不能辨認同一主力，也不是市場總淨買賣超。",
    true,
  );
  const levels = {},
    large = [],
    small = [];
  for (const r of rows("TaiwanStockHoldingSharesPer"))
    (levels[r.date] ??= []).push(r);
  for (const [period, rs] of Object.entries(levels).sort()) {
    const big = new Map(),
      little = new Map();
    for (const r of rs) {
      const level = String(r.HoldingSharesLevel ?? "").replaceAll(",", ""),
        value = num(r.percent);
      if (value == null) continue;
      const match = /^(\d+)(?:-(\d+))?$/.exec(level);
      if (match) {
        if (Number(match[1]) > 400000) big.set(level, value);
        if (match[2] && Number(match[2]) <= 5000) little.set(level, value);
      } else if (["morethan1000000", "1000001以上"].includes(level))
        big.set("morethan1000000", value);
    }
    if (big.size === 4) large.push({ period, value: sum([...big.values()]) });
    if (little.size === 2)
      small.push({ period, value: sum([...little.values()]) });
  }
  add(
    "large_holders",
    "逾400張股東持股占比",
    large,
    "%",
    "持股分級通常週更新；大戶占比不是主力身分。先看相鄰週變化，再搭配股價與成交量。",
  );
  add(
    "small_holders",
    "5張以下股東持股占比",
    small,
    "%",
    "合計已辨識的5張以下級距；未把「差異數」或合計列加進占比。",
  );
  details.distribution = rows("TaiwanStockHoldingSharesPer").sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      String(b.HoldingSharesLevel).localeCompare(String(a.HoldingSharesLevel)),
  );
  const branchRows = rows("TaiwanStockTradingDailyReport"),
    branchDate =
      branchRows
        .map((r) => r.date)
        .sort()
        .at(-1) ?? null,
    branches = {},
    branchHistory = {};
  for (const r of branchRows) {
    const buy = num(r.buy),
      sell = num(r.sell);
    if (buy == null || sell == null) continue;
    const id = String(r.securities_trader_id || r.securities_trader);
    (branchHistory[r.date] ??= new Set()).add(id);
    if (r.date !== branchDate) continue;
    const entry = (branches[id] ??= {
      id,
      name: r.securities_trader || id,
      buy: 0,
      sell: 0,
      date: branchDate,
    });
    entry.buy += buy;
    entry.sell += sell;
  }
  details.branches = Object.values(branches)
    .map((e) => ({ ...e, net: e.buy - e.sell }))
    .sort((a, b) => b.net - a.net);
  add(
    "branches",
    "可查詢券商分點數",
    details.branches.length
      ? [{ period: branchDate, value: details.branches.length }]
      : [],
    "個",
    "依最新已取得分點日彙總同一分點所有價格成交；不把自營商零價格記錄算成成本。",
  );
  history.branches = Object.entries(branchHistory)
    .sort()
    .map(([period, ids]) => ({ period, value: ids.size }));
  add(
    "foreign_holding",
    "外資持股比率",
    rows("TaiwanStockShareholding")
      .filter((r) => num(r.ForeignInvestmentSharesRatio) != null)
      .map((r) => ({
        period: r.date,
        value: num(r.ForeignInvestmentSharesRatio),
      })),
    "%",
    "這是持股存量，與外資當日買賣超不同；比率高不等於即將上漲。",
  );
  return { metrics, history, details, branch_date: branchDate };
}
export async function view(market, symbol, start, end, cutoff = now()) {
  const all = await snapshots(market, symbol, cutoff, Object.keys(DATASETS)),
    selected = {};
  for (const s of all) selected[s.dataset] ??= s;
  const visibleEnd = end < taipeiDay(cutoff) ? end : taipeiDay(cutoff),
    data = Object.fromEntries(
      Object.entries(selected).map(([d, s]) => [
        d,
        s.data.filter(
          (r) =>
            r.date <= (d === "CompanyProfile" ? taipeiDay(cutoff) : visibleEnd),
        ),
      ]),
    ),
    result = chipSummary(data, start, visibleEnd, market),
    dates = Object.values(data)
      .flat()
      .map((r) => r.date)
      .sort();
  result.history = chipSummary(
    data,
    dates[0] ?? start,
    visibleEnd,
    market,
  ).history;
  const instrument = (
      await queryRows(
        "SELECT * FROM instruments WHERE market=$1 AND symbol=$2",
        [market, symbol],
      )
    )[0],
    reports = [...(data.AnalystTargetReport ?? [])].sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
    targets = {},
    targetHistory = [];
  for (const day of [...new Set(reports.map((r) => r.date))]) {
    const known = {};
    for (const r of reports)
      if (daysBetween(day, r.date) >= 0 && daysBetween(day, r.date) <= 180)
        known[r.institution] = r;
    if (Object.keys(known).length)
      targetHistory.push({
        period: day,
        value: median(Object.values(known).map((r) => num(r.target_price))),
      });
  }
  for (const r of reports)
    if (daysBetween(visibleEnd, r.date) <= 180) targets[r.institution] = r;
  const prices = Object.values(targets).map((r) => num(r.target_price)),
    fundRows = [
      ...(data.TaiwanStockActiveETFHolding ?? []),
      ...(data.FundHoldingsReport ?? []),
    ],
    funds = {};
  for (const r of [...fundRows].sort((a, b) => a.date.localeCompare(b.date)))
    funds[r.fund_code] = r;
  return {
    ...result,
    market,
    symbol,
    start,
    end: visibleEnd,
    as_of: cutoff,
    profile: data.CompanyProfile?.at(-1) ?? null,
    catalogue: instrument
      ? {
          name: instrument.name,
          industry: instrument.industry,
          updated_at: instrument.updated_at,
        }
      : null,
    targets: {
      reports: Object.values(targets),
      history: targetHistory,
      median: prices.length ? median(prices) : null,
      low: prices.length ? Math.min(...prices) : null,
      high: prices.length ? Math.max(...prices) : null,
      note: "僅保留截止日180天內每家機構最新報告；是機構意見，不是模型預測或保證價格。",
    },
    fund_holdings: Object.values(funds),
    fund_history: fundRows,
    coverage: Object.entries(DATASETS).map(
      ([dataset, [label, entitlement]]) => ({
        dataset,
        label,
        entitlement,
        status: data[dataset]?.length
          ? "available"
          : ["AnalystTargetReport", "FundHoldingsReport"].includes(dataset)
            ? "not_connected"
            : entitlement &&
                dataset !== "TaiwanStockHoldingSharesPer" &&
                !process.env.FINMIND_TOKEN
              ? "requires_token"
              : dataset === "TaiwanStockActiveETFHolding" &&
                  !process.env.ETF_WATCHLIST
                ? "not_configured"
                : "no_data",
        source: selected[dataset]?.source ?? null,
        received_at: selected[dataset]?.received_at ?? null,
        revision: selected[dataset]?.revision ?? null,
      }),
    ),
    note: "歷史視角只使用平台當時已接收的修訂；現在取得的公司資料不回填為過去已知。部分來源有付費權限，未取得時不使用替代數字。",
  };
}
