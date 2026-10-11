import { num, sum } from "./lib.js";

const completeSum = (values) =>
  values.length && values.every((v) => v != null) ? sum(values) : null;
export function holdingBands(items) {
  const groups = new Map();
  for (const r of items) {
    const text = String(r.HoldingSharesLevel).replaceAll(",", "");
    const match = /^(\d+)-(\d+)$/.exec(text);
    const low = match
      ? Number(match[1])
      : ["morethan1000000", "1000001以上"].includes(text)
        ? 1000001
        : null;
    if (low == null) continue;
    const high = match ? Number(match[2]) : Infinity;
    if (num(r.percent) == null) continue;
    (groups.get(r.date) ?? groups.set(r.date, new Map()).get(r.date)).set(low, {
      low,
      high,
      value: num(r.percent),
    });
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, bands]) => {
      const aggregate = (lower, upper) => {
        const selected = [...bands.values()]
          .filter((r) => r.low >= lower && r.high <= upper)
          .sort((a, b) => a.low - b.low);
        let cursor = lower;
        for (const r of selected) {
          if (r.low !== cursor) return null;
          cursor = r.high + 1;
        }
        return cursor === upper + 1 ? sum(selected.map((r) => r.value)) : null;
      };
      return {
        date,
        large400: aggregate(400001, Infinity),
        large1000: aggregate(1000001, Infinity),
        small20: aggregate(1, 20000),
        small50: aggregate(1, 50000),
      };
    });
}

export function buildChipWorkspace(
  data,
  start,
  end,
  institutions,
  prices = [],
) {
  const inside = (r) => start <= r.date && r.date <= end;
  const closes = new Map(prices.map((r) => [r.trade_date, r.close]));
  const priceRows = prices.filter((r) => inside({ date: r.trade_date }));
  const bands = holdingBands(data.TaiwanStockHoldingSharesPer ?? []);
  const ownership = bands
    .map((r, i) => ({
      ...r,
      large400_change: i
        ? r.large400 != null && bands[i - 1].large400 != null
          ? r.large400 - bands[i - 1].large400
          : null
        : null,
      large1000_change: i
        ? r.large1000 != null && bands[i - 1].large1000 != null
          ? r.large1000 - bands[i - 1].large1000
          : null
        : null,
      small20_change: i
        ? r.small20 != null && bands[i - 1].small20 != null
          ? r.small20 - bands[i - 1].small20
          : null
        : null,
      small50_change: i
        ? r.small50 != null && bands[i - 1].small50 != null
          ? r.small50 - bands[i - 1].small50
          : null
        : null,
      close: closes.get(r.date) ?? null,
    }))
    .filter(inside);
  const shareholding = (data.TaiwanStockShareholding ?? [])
    .filter(inside)
    .map((r) => ({
      date: r.date,
      foreign: num(r.ForeignInvestmentSharesRatio),
    }));
  const byDate = new Map(shareholding.map((r) => [r.date, r.foreign]));
  const directors = (data.DirectorHoldingsReport ?? []).filter(
    (r) => r.date <= end,
  );
  const directorDate = directors
    .map((r) => r.date)
    .sort()
    .at(-1);
  const directorRows = directors.filter((r) => r.date === directorDate);
  const directorHistory = [...new Set(directors.map((r) => r.date))]
    .sort()
    .map((date) => ({
      date,
      holding_shares: completeSum(
        directors
          .filter((r) => r.date === date && r.aggregate_eligible === true)
          .map((r) => num(r.holding_shares)),
      ),
      pledge_shares: completeSum(
        directors
          .filter((r) => r.date === date && r.aggregate_eligible === true)
          .map((r) => num(r.pledge_shares)),
      ),
    }));
  const structure = ownership.map((r) => ({
    ...r,
    foreign: byDate.get(r.date) ?? null,
    trust: null,
    dealer: null,
    director: null,
  }));
  const branches = (data.TaiwanStockTradingDailyReport ?? []).filter(inside);
  const grouped = new Map();
  for (const r of branches) {
    if (num(r.buy) == null || num(r.sell) == null) continue;
    const id = String(r.securities_trader_id || r.securities_trader);
    const key = r.date + ":" + id;
    const item = grouped.get(key) ?? {
      date: r.date,
      id,
      name: r.securities_trader || id,
      buy: 0,
      sell: 0,
    };
    item.buy += num(r.buy);
    item.sell += num(r.sell);
    grouped.set(key, item);
  }
  const branchDaily = [...grouped.values()].map((r) => ({
    ...r,
    net: r.buy - r.sell,
  }));
  const concentration = new Map(
    (data.TaiwanStockBrokerDailyConcentration ?? []).map((r) => [
      r.date,
      num(r.top_buy_volume) != null && num(r.top_sell_volume) != null
        ? num(r.top_buy_volume) - num(r.top_sell_volume)
        : null,
    ]),
  );
  const mainRows = prices
    .map((r, i) => {
      const rolling = (n) => {
        const window = prices.slice(i - n + 1, i + 1);
        if (i < n - 1 || window.length !== n) return null;
        const values = window.map(
          (p) => concentration.get(p.trade_date) ?? null,
        );
        const total = completeSum(values);
        const volume = completeSum(window.map((p) => num(p.volume)));
        return total != null && volume > 0 ? (total / volume) * 100 : null;
      };
      return {
        date: r.trade_date,
        close: r.close,
        net: concentration.get(r.trade_date) ?? null,
        house_difference: null,
        concentration5: rolling(5),
        concentration20: rolling(20),
      };
    })
    .filter(inside);
  // No count is inferred from a partial set of broker records.
  const margin = (data.TaiwanStockMarginPurchaseShortSale ?? [])
    .filter(inside)
    .map((r) => {
      const lots = (key) => (num(r[key]) == null ? null : num(r[key]) * 1000);
      const balance = lots("MarginPurchaseTodayBalance"),
        short = lots("ShortSaleTodayBalance");
      const ratio = (a, b) => (a != null && b > 0 ? (a / b) * 100 : null);
      return {
        date: r.date,
        margin_balance: balance,
        margin_change:
          balance != null && lots("MarginPurchaseYesterdayBalance") != null
            ? balance - lots("MarginPurchaseYesterdayBalance")
            : null,
        margin_usage: ratio(balance, lots("MarginPurchaseLimit")),
        short_balance: short,
        short_change:
          short != null && lots("ShortSaleYesterdayBalance") != null
            ? short - lots("ShortSaleYesterdayBalance")
            : null,
        short_usage: ratio(short, lots("ShortSaleLimit")),
        short_margin_ratio: ratio(short, balance),
        offset: lots("OffsetLoanAndShort"),
        offset_ratio: ratio(
          lots("OffsetLoanAndShort"),
          num(prices.find((p) => p.trade_date === r.date)?.volume),
        ),
        close: closes.get(r.date) ?? null,
      };
    });
  const fundsRaw = [
    ...(data.TaiwanStockActiveETFHolding ?? []),
    ...(data.FundHoldingsReport ?? []),
  ].filter((r) => r.date <= end);
  const latest = new Map();
  for (const r of [...fundsRaw].sort((a, b) => a.date.localeCompare(b.date)))
    latest.set(r.fund_code, r);
  const funds = [...latest.values()]
    .filter((r) => num(r.holding_shares) > 0)
    .map((r) => {
      const monthStart = r.date.slice(0, 7) + "-01";
      const previous = fundsRaw
        .filter((p) => p.fund_code === r.fund_code && p.date < monthStart)
        .sort((a, b) => a.date.localeCompare(b.date))
        .at(-1);
      return {
        ...r,
        holding_value: num(r.holding_value),
        weight_change:
          previous &&
          num(previous.weight_percent) != null &&
          num(r.weight_percent) != null
            ? num(r.weight_percent) - num(previous.weight_percent)
            : null,
        comparison_date: previous?.date ?? null,
      };
    });
  return {
    institutions: institutions.map((r) => ({
      ...r,
      total: completeSum([r.foreign, r.trust, r.dealer]),
      close: closes.get(r.date) ?? null,
    })),
    main: mainRows,
    branches: branchDaily,
    ownership,
    structure,
    margin,
    directors: directorRows,
    director_history: directorHistory.filter(inside),
    transfers: (data.InsiderTransfersReport ?? []).filter(inside),
    funds,
    fund_history: fundsRaw.filter(inside),
    prices: priceRows.map((r) => ({ date: r.trade_date, close: r.close })),
    definitions: {
      main: "本平台前15大分點集中度；未宣稱與CMoney主力口徑一致。家數差尚無完整來源。",
      margin:
        "融資融券來源數量為張，保存原始值，輸出轉為股。互抵比為資券互抵股數／成交股數，與現股當沖率分開。",
      ownership:
        "大戶逾400／1000張；散戶20／50張以下。前期變化為百分點，僅比較已取得相鄰觀測，需核對日期間隔。",
      structure:
        "投信、自營商及董監持股占比尚無可比來源，留空，不從每日買賣超推算。",
    },
  };
}
