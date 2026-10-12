import Decimal from "decimal.js";

export function statedShares(message = "") {
  const quantities = new Set();
  const chinese = {
    一: 1,
    二: 2,
    兩: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  for (const m of message.matchAll(
    /(\d+(?:,\d{3})*|[一二兩三四五六七八九十百千萬]+)\s*(張|股)/g,
  )) {
    const tens = /^([一二兩三四五六七八九]?)十([一二兩三四五六七八九]?)$/.exec(
      m[1],
    );
    const n =
      chinese[m[1]] ??
      (tens
        ? (chinese[tens[1]] || 1) * 10 + (chinese[tens[2]] || 0)
        : Number(m[1].replaceAll(",", "")));
    if (n > 0) quantities.add(n * (m[2] === "張" ? 1000 : 1));
  }
  return quantities;
}

// Operands must come from this run's stock prices, not arbitrary AI targets.
export function calculateTrade(args, snapshot, message) {
  const prices = new Set();
  const add = (v) => {
    if (typeof v === "number" && Number.isFinite(v) && v > 0)
      prices.add(new Decimal(v).toDecimalPlaces(2).toString());
  };
  const report = snapshot.report;
  for (const bar of snapshot.input.bars || [])
    for (const k of ["open", "high", "low", "close"]) add(bar[k]);
  for (const [k, v] of Object.entries(report.metrics || {}))
    if (/^ma\d+$|^bb_(upper|lower)|^prior_high\d+$/.test(k)) add(v);
  for (const e of report.evidence || [])
    if (e.id === "price:last" || e.id === "quote:snapshot") {
      add(e.value);
      for (const k of ["price", "last", "open", "high", "low", "close"])
        add(e.data?.[k]);
    }
  for (const k of ["buy_price", "sell_price"])
    if (!prices.has(String(args[k])))
      throw Error("試算買賣價須引用本次股票K線或均線等價格，不能自行編造");
  if (!statedShares(message).has(args.shares))
    throw Error("試算股數須由使用者本次問題提供，例如一張或1000股");
  const delta = new Decimal(args.sell_price).minus(args.buy_price);
  return {
    buy_price: args.buy_price,
    sell_price: args.sell_price,
    shares: args.shares,
    price_difference: delta.toNumber(),
    gross_profit: delta.times(args.shares).toNumber(),
    net_profit: null,
    formula: "毛損益＝（賣價－買價）×股數",
    note: "條件式試算，未扣手續費與交易稅，不是預測、保證獲利或已成交損益；費用未提供不計算淨利。",
  };
}
