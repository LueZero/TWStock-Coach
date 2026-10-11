import Decimal from "decimal.js";
import { validDate, integer, fail } from "./lib.js";
Decimal.set({ precision: 40 });
const D = (v) => new Decimal(v),
  roundings = {
    floor: Decimal.ROUND_FLOOR,
    nearest: Decimal.ROUND_HALF_UP,
    ceil: Decimal.ROUND_CEIL,
  };
const money = (v) =>
  v == null ? null : D(v).toFixed(2, Decimal.ROUND_HALF_UP);
export function tickCents(cents, asset) {
  return ["etf", "bond_etf"].includes(asset)
    ? cents < 5000
      ? 1
      : 5
    : asset === "custom"
      ? 1
      : cents < 1000
        ? 1
        : cents < 5000
          ? 5
          : cents < 10000
            ? 10
            : cents < 50000
              ? 50
              : cents < 100000
                ? 100
                : 500;
}
export function moveTicks(price, steps, asset) {
  let cents = D(price).times(100).toNumber();
  if (
    !Number.isInteger(cents) ||
    cents < 1 ||
    cents > 100000000 ||
    cents % tickCents(cents, asset)
  )
    fail("進場價格不符合升降單位");
  for (let i = 0; i < Math.abs(steps); i++) {
    cents =
      steps > 0
        ? cents + tickCents(cents, asset)
        : Math.floor((cents - 1) / tickCents(cents - 1, asset)) *
          tickCents(cents - 1, asset);
    if (cents < 1 || cents > 100000000) fail("跳檔後價格超出試算範圍");
  }
  return D(cents).div(100);
}
export function scenarioPrice(price, change, asset) {
  const raw = D(price)
    .times(D(1).plus(D(change).div(100)))
    .times(100);
  let tick = tickCents(raw.floor().toNumber(), asset),
    cents = 0;
  for (let i = 0; i < 3; i++) {
    cents = raw
      .div(tick)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .times(tick)
      .toNumber();
    const next = tickCents(cents, asset);
    if (next === tick) break;
    tick = next;
  }
  return D(cents).div(100);
}
export function defaultTax(asset, mode, day) {
  if (asset === "stock")
    return D(
      mode.startsWith("day_") && day >= "2017-04-28" && day <= "2027-12-31"
        ? ".15"
        : ".3",
    );
  if (asset === "etf") return D(".1");
  if (asset === "bond_etf")
    return D(day >= "2017-01-01" && day <= "2026-12-31" ? 0 : ".1");
  return null;
}
function decimal(value, min, max, places, label) {
  let d;
  try {
    if (value == null || typeof value === "boolean") throw Error();
    if (
      typeof value === "string" &&
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())
    )
      throw Error();
    d = D(value);
  } catch {
    fail(label + "格式不符");
  }
  if (!d.isFinite() || d.lt(min) || d.gt(max) || d.decimalPlaces() > places)
    fail(label + "超出範圍或小數位過多");
  return d;
}
export function validateCalculation(input) {
  const r = {
    mode: "roundtrip",
    asset: "stock",
    close_change_percent: null,
    close_tick_change: null,
    scenario_mode: "percent",
    scenario_tick_step: 1,
    scenario_up_step: "1",
    scenario_down_step: "1",
    scenario_steps: 5,
    quantity: 1,
    unit: "lots",
    fee_percent: ".1425",
    discount: 10,
    minimum_fee: 20,
    tax_percent: null,
    fee_rounding: "floor",
    tax_rounding: "floor",
    extra_cost: 0,
    buy_price: null,
    sell_price: null,
    ...input,
  };
  validDate(r.trade_date);
  for (const [key, allowed] of Object.entries({
    mode: ["buy", "sell", "roundtrip", "day_long", "day_short"],
    asset: ["stock", "etf", "bond_etf", "custom"],
    unit: ["lots", "shares"],
    scenario_mode: ["percent", "ticks"],
    fee_rounding: Object.keys(roundings),
    tax_rounding: Object.keys(roundings),
  }))
    if (!allowed.includes(r[key])) fail(key + "不符");
  for (const key of ["buy_price", "sell_price"])
    if (r[key] != null) r[key] = decimal(r[key], ".01", 1000000, 2, key);
  for (const [key, min, max, places] of [
    ["scenario_up_step", ".001", 10, 3],
    ["scenario_down_step", ".001", 10, 3],
    ["fee_percent", 0, 5, 6],
    ["discount", 0, 10, 3],
    ["minimum_fee", 0, 100000, 0],
    ["extra_cost", 0, 100000000, 2],
  ])
    r[key] = decimal(r[key], min, max, places, key);
  if (r.tax_percent != null)
    r.tax_percent = decimal(r.tax_percent, 0, 5, 6, "交易稅");
  if (r.close_change_percent != null)
    r.close_change_percent = decimal(
      r.close_change_percent,
      -50,
      50,
      3,
      "漲跌比例",
    );
  integer(r.quantity, 1, 100000000, "股數");
  integer(r.scenario_steps, 1, 10, "格數");
  integer(r.scenario_tick_step, 1, 20, "每格檔數");
  if (r.close_tick_change != null)
    integer(r.close_tick_change, -200, 200, "出場檔數");
  if (
    r.scenario_mode === "percent" &&
    Decimal.max(r.scenario_up_step, r.scenario_down_step)
      .times(r.scenario_steps)
      .gt(50)
  )
    fail("每格比例乘格數不能超過50%");
  if (r.close_change_percent != null && r.close_tick_change != null)
    fail("比例與跳檔不能同時套用");
  const anchor = r.mode === "day_short" ? r.sell_price : r.buy_price;
  if (
    !["buy", "sell"].includes(r.mode) &&
    (r.scenario_mode === "ticks" || r.close_tick_change != null)
  ) {
    if (anchor == null) fail("請輸入第一筆進場價格");
    moveTicks(anchor, 0, r.asset);
  }
  if (r.close_tick_change != null || r.close_change_percent != null) {
    if (["buy", "sell"].includes(r.mode) && r.close_tick_change != null)
      fail("單邊試算不能套用出場跳檔");
    if (!["buy", "sell"].includes(r.mode)) {
      if (anchor == null) fail("請輸入第一筆進場價格");
      const price =
        r.close_tick_change != null
          ? moveTicks(anchor, r.close_tick_change, r.asset)
          : scenarioPrice(anchor, r.close_change_percent, r.asset);
      if (price.lt(".01") || price.gt(1000000)) fail("換算後價格超出試算範圍");
      r[r.mode === "day_short" ? "buy_price" : "sell_price"] = price;
    }
  }
  if (r.mode !== "sell" && r.buy_price == null) fail("請輸入買進價格");
  if (r.mode !== "buy" && r.sell_price == null) fail("請輸入賣出價格");
  r.shares = r.quantity * (r.unit === "lots" ? 1000 : 1);
  if (r.mode.startsWith("day_") && r.shares % 1000)
    fail("現股當沖不適用零股；請使用整張數量");
  if (r.asset === "custom" && r.tax_percent == null)
    fail("自訂商品請填寫交易稅率");
  return r;
}
export function calculate(input, withScenarios = true, validated = false) {
  const r = validated ? input : validateCalculation(input),
    shares = D(r.shares),
    rate = r.fee_percent.div(100).times(r.discount).div(10),
    tax = r.tax_percent ?? defaultTax(r.asset, r.mode, r.trade_date);
  const leg = (side, price) => {
    const amount = price.times(shares),
      fee = Decimal.max(
        r.minimum_fee,
        amount.times(rate).toDecimalPlaces(0, roundings[r.fee_rounding]),
      ),
      levy =
        side === "sell"
          ? amount
              .times(tax)
              .div(100)
              .toDecimalPlaces(0, roundings[r.tax_rounding])
          : D(0);
    return {
      side,
      price,
      amount,
      fee,
      tax: levy,
      cash_flow:
        side === "sell"
          ? amount.minus(fee).minus(levy)
          : amount.plus(fee).negated(),
    };
  };
  const sides =
      r.mode === "buy"
        ? ["buy"]
        : r.mode === "sell"
          ? ["sell"]
          : r.mode === "day_short"
            ? ["sell", "buy"]
            : ["buy", "sell"],
    legs = sides.map((side) => leg(side, r[side + "_price"])),
    cash = legs.reduce((s, l) => s.plus(l.cash_flow), D(0)).minus(r.extra_cost),
    profit = legs.length === 2 ? cash : null,
    denominator = legs[0].cash_flow.abs();
  let breakeven = null;
  if (legs.length === 2) {
    const short = r.mode === "day_short",
      fixed = leg(
        short ? "sell" : "buy",
        short ? r.sell_price : r.buy_price,
      ).cash_flow,
      net = (cents) =>
        fixed
          .plus(leg(short ? "buy" : "sell", D(cents).div(100)).cash_flow)
          .minus(r.extra_cost);
    let lo = 1,
      hi = 100000000;
    if ((short ? net(lo) : net(hi)).gte(0)) {
      while (lo < hi) {
        const mid = Math.floor((lo + hi + (short ? 1 : 0)) / 2);
        if (short) {
          if (net(mid).gte(0)) lo = mid;
          else hi = mid - 1;
        } else if (net(mid).gte(0)) hi = mid;
        else lo = mid + 1;
      }
      let cents = lo;
      for (let i = 0; i < 3; i++) {
        const tick = tickCents(cents, r.asset),
          rounded =
            (short ? Math.floor(cents / tick) : Math.ceil(cents / tick)) * tick;
        if (rounded === cents) break;
        cents = rounded;
      }
      if (cents > 0 && net(cents).gte(0)) breakeven = D(cents).div(100);
    }
  }
  const result = {
    mode: r.mode,
    shares: r.shares,
    effective_fee_percent: rate.times(100).toString(),
    tax_percent: tax.toString(),
    tax_overridden: r.tax_percent != null,
    legs: legs.map((l) =>
      Object.fromEntries(
        Object.entries(l).map(([k, v]) => [
          k,
          v instanceof Decimal ? money(v) : v,
        ]),
      ),
    ),
    fees: money(legs.reduce((s, l) => s.plus(l.fee), D(0))),
    tax: money(legs.reduce((s, l) => s.plus(l.tax), D(0))),
    extra_cost: money(r.extra_cost),
    cash_flow: money(cash),
    net_profit: money(profit),
    return_percent:
      profit != null && denominator.gt(0)
        ? money(profit.div(denominator).times(100))
        : null,
    return_basis:
      r.mode === "day_short"
        ? "賣出實收金額；不是保證金報酬率"
        : "買入金額加買入手續費",
    breakeven_price: money(breakeven),
    breakeven_side: r.mode === "day_short" ? "buy" : "sell",
    note: "單一買進與賣出成交、同數量全數沖銷試算；最低手續費每邊各計一次。實際券商可能分筆、先收後退折扣或採不同取整；以對帳單為準。先賣後買若未回補，額外借券、強制買回與價差未自動估算。",
  };
  if (withScenarios && legs.length === 2) {
    const closing = r.mode === "day_short" ? "buy_price" : "sell_price",
      anchor = r.mode === "day_short" ? r.sell_price : r.buy_price;
    result.scenario_anchor = money(anchor);
    result.scenario_mode = r.scenario_mode;
    result.tick_info = {};
    for (const [direction, steps] of [
      ["up", 1],
      ["down", -1],
    ]) {
      try {
        const adjacent = moveTicks(anchor, steps, r.asset),
          difference = adjacent.minus(anchor).abs();
        result.tick_info[direction] = {
          price: money(adjacent),
          difference: money(difference),
          gross_amount: money(difference.times(shares)),
        };
      } catch {
        result.tick_info[direction] = null;
      }
    }
    if (
      anchor.times(100).toNumber() %
      tickCents(anchor.times(100).toNumber(), r.asset)
    )
      result.tick_info = null;
    result.scenarios = [];
    for (let i = -r.scenario_steps; i <= r.scenario_steps; i++) {
      const change =
        r.scenario_mode === "ticks"
          ? i * r.scenario_tick_step
          : (i < 0 ? r.scenario_down_step : r.scenario_up_step).times(i);
      let price;
      try {
        price =
          r.scenario_mode === "ticks"
            ? moveTicks(anchor, change, r.asset)
            : scenarioPrice(anchor, change, r.asset);
      } catch {
        continue;
      }
      if (price.lt(".01") || price.gt(1000000)) continue;
      const trial = calculate({ ...r, [closing]: price }, false, true);
      result.scenarios.push({
        tick_change: r.scenario_mode === "ticks" ? change : null,
        change_percent:
          r.scenario_mode === "percent" ? change.toString() : null,
        price: money(price),
        price_difference: money(price.minus(anchor)),
        gross_profit: money(
          (r.mode === "day_short"
            ? anchor.minus(price)
            : price.minus(anchor)
          ).times(shares),
        ),
        actual_change_percent: money(price.div(anchor).minus(1).times(100)),
        net_profit: trial.net_profit,
        return_percent: trial.return_percent,
      });
    }
  }
  return result;
}
