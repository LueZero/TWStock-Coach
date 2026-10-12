import test from "node:test";
import assert from "node:assert/strict";
import { createStockTools } from "../tools.js";
import { statedShares } from "../trade-math.js";
import { validateExplanation } from "../report-schema.js";

test("損益試算使用本次來源價格及使用者股數，精確計算毛利與虧損", async () => {
  const calls = [];
  const snapshot = {
    input: { bars: [{ close: 38.8, high: 40.8 }] },
    report: { metrics: { ma20: 38.49999999999999 }, evidence: [] },
  };
  const tools = createStockTools(
    {
      api_url: "http://127.0.0.1:8000",
      user_message: "希望買一張可以賺得2000元",
      scope: {
        market: "TWSE",
        symbol: "2883",
        mode: "historical",
        start: "2026-04-15",
        end: "2026-10-12",
        as_of: "2026-10-12T15:00:00Z",
      },
      snapshot,
    },
    {
      fetcher: () => {
        throw Error("不應查詢外部資料");
      },
      onCall: (c) => calls.push(c),
    },
  );
  const result = await tools.call("calculate_trade_profit", {
    buy_price: 38.5,
    sell_price: 40.8,
    shares: 1000,
  });
  assert.equal(result.data.price_difference, 2.3);
  assert.equal(result.data.gross_profit, 2300);
  assert.equal(result.data.net_profit, null);
  const loss = await tools.call("calculate_trade_profit", {
    buy_price: 40.8,
    sell_price: 38.5,
    shares: 1000,
  });
  assert.equal(loss.data.gross_profit, -2300);
  await assert.rejects(
    tools.call("calculate_trade_profit", {
      buy_price: 38.5,
      sell_price: 99,
      shares: 1000,
    }),
    /不能自行編造/,
  );
  await assert.rejects(
    tools.call("calculate_trade_profit", {
      buy_price: 38.5,
      sell_price: 40.8,
      shares: 2000,
    }),
    /股數/,
  );
  await assert.rejects(
    tools.call("calculate_trade_profit", {
      buy_price: "38.5",
      sell_price: 40.8,
      shares: 1000,
    }),
    /參數/,
  );
  assert.deepEqual([...statedShares("買兩張，另外300股")], [2000, 300]);
  assert.deepEqual([...statedShares("十一張、二十張")], [11000, 20000]);
  assert.equal(statedShares("一百張").size, 0);
  const value = {
    answer: "每股價差2.3元，一張毛利2,300元，未扣費用。",
    highlights: [
      { text: "試算毛利2300元。", evidence_ids: [result.evidence_id] },
    ],
    scenario_ids: [],
    cautions: [],
  };
  const report = {
    evidence: [{ id: result.evidence_id, data: result.data }],
    scenarios: [],
  };
  assert.doesNotThrow(() => validateExplanation(value, report));
  const lossReport = {
    evidence: [{ id: loss.evidence_id, data: loss.data }],
    scenarios: [],
  };
  assert.doesNotThrow(() =>
    validateExplanation(
      { ...value, answer: "毛損失2,300元。", highlights: [] },
      lossReport,
    ),
  );
  assert.throws(
    () =>
      validateExplanation(
        { ...value, answer: "毛利2,300元。", highlights: [] },
        lossReport,
      ),
    /非平台計算價位/,
  );
  assert.throws(
    () => validateExplanation({ ...value, answer: "買進價格99元。" }, report),
    /非平台計算價位/,
  );
  assert.equal(calls.filter((c) => c.status === "completed").length, 2);
});

test("負數財報文字可引用，沒有工具的心算與無來源價位仍拒絕", () => {
  const report = {
    evidence: [{ id: "eps", value: -0.23 }],
    scenarios: [],
    user_message: "一張賺2000元",
  };
  const value = {
    answer: "去年EPS為負0.23元。目標2000元。",
    highlights: [],
    scenario_ids: [],
    cautions: [],
  };
  assert.doesNotThrow(() => validateExplanation(value, report));
  assert.doesNotThrow(() =>
    validateExplanation({ ...value, answer: "去年EPS為－0.23元。" }, report),
  );
  assert.throws(
    () => validateExplanation({ ...value, answer: "EPS為0.23元。" }, report),
    /非平台計算價位/,
  );
  assert.throws(
    () => validateExplanation({ ...value, answer: "毛利2300元。" }, report),
    /2300元/,
  );
});
