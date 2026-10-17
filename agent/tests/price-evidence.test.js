import test from "node:test";
import assert from "node:assert/strict";
import { validateExplanation } from "../report-schema.js";
import { calculateTrade } from "../trade-math.js";

const report = {
  metrics: { ma20: 38.5, rsi14: 60, volume_ratio: 1.5, atr14: 2 },
  scenarios: [{ id: "breakout", trigger: 39.15, stop: 37.15, target: 43.15 }],
  evidence: [
    { id: "price:last", value: 38.8 },
    {
      id: "quote:snapshot",
      rows: [{ last_price: 38.85, high: 39.1, low: 37.1, volume_shares: 1000 }],
    },
    { id: "financial:eps", value: 0.95, unit: "元／股" },
    { id: "market:index", value: 9999, unit: "點" },
    {
      id: "tool:technical",
      data: { bars: { rows: [{ close: 38.8, volume: 1000 }] } },
    },
  ],
  user_message: "買一張，希望賺2000元",
};
const answer = (text) => ({
  answer: text,
  highlights: [],
  scenario_ids: [],
  cautions: [],
});

test("買賣價位不以成交量、RSI、ATR、EPS、指數或獲利願望充當依據", () => {
  for (const price of [1000, 60, 1.5, 2, 0.95, 9999, 2000])
    for (const text of [`買進價格${price}元。`, `${price}元買進、先觀察。`])
      assert.throws(
        () => validateExplanation(answer(text), report),
        /非平台計算價位/,
      );
  for (const price of [38.5, 38.8, 38.85, 39.1, 37.1, 39.15, 37.15, 43.15])
    assert.doesNotThrow(() =>
      validateExplanation(answer(`買入價${price}元。`), report),
    );
  assert.doesNotThrow(() =>
    validateExplanation(
      answer("EPS為0.95元，獲利目標2000元並非保證。"),
      report,
    ),
  );
  assert.doesNotThrow(() =>
    validateExplanation(answer("觀察支撐20日線是否守穩。"), report),
  );
  assert.doesNotThrow(() =>
    validateExplanation(
      answer("尚未買入：10/13 或2026-10-13的10:30先核對量價。"),
      report,
    ),
  );
});

test("試算接受即時快照與平台情境價，仍拒絕非價格欄位", () => {
  const snapshot = { report, input: { bars: [] } };
  const calculation = calculateTrade(
    { buy_price: 38.85, sell_price: 43.15, shares: 1000 },
    snapshot,
    report.user_message,
  );
  assert.equal(calculation.gross_profit, 4300);
  assert.throws(
    () =>
      calculateTrade(
        { buy_price: 1000, sell_price: 43.15, shares: 1000 },
        snapshot,
        report.user_message,
      ),
    /不能自行編造/,
  );
});

test("均線參考值與實際委託價分開，股票和ETF使用各自合法跳檔", () => {
  const r = { ...report, metrics: { ma20: 38.49 } };
  assert.doesNotThrow(() =>
    validateExplanation(answer("均線參考為38.49元。"), r),
  );
  assert.throws(
    () => validateExplanation(answer("買入價38.49元。"), r),
    /非平台計算價位/,
  );
  assert.throws(
    () => validateExplanation(answer("買進價格38.49元。"), r),
    /非平台計算價位/,
  );
  assert.doesNotThrow(() => validateExplanation(answer("買入價38.50元。"), r));
  const snapshot = { report: r, input: { bars: [] } };
  assert.throws(
    () =>
      calculateTrade(
        { buy_price: 38.49, sell_price: 43.15, shares: 1000 },
        snapshot,
        report.user_message,
      ),
    /合法跳檔/,
  );
  assert.equal(
    calculateTrade(
      { buy_price: 38.5, sell_price: 43.15, shares: 1000 },
      snapshot,
      report.user_message,
    ).gross_profit,
    4650,
  );
  const etf = { ...r, asset: "etf" };
  assert.doesNotThrow(() =>
    validateExplanation(answer("買入價38.49元。"), etf),
  );
});
