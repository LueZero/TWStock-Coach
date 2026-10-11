import test from "node:test";
import assert from "node:assert/strict";
import { chipSummary } from "../api/equity.js";

const row = (date, name, buy, sell) => ({ date, name, buy, sell });
function summary(rows, start, end, market = "TWSE") {
  return chipSummary(
    { TaiwanStockInstitutionalInvestorsBuySell: rows },
    start,
    end,
    market,
  );
}
const foreign = (result) => result.metrics.find((m) => m.key === "foreign");

test("外資含外資自營商，依所選區間加總並保留每日值", () => {
  const result = summary(
    [
      row("2026-10-06", "Foreign_Investor", 1000, 200),
      row("2026-10-06", "Foreign_Dealer_Self", 10, 30),
      row("2026-10-07", "Foreign_Investor", 100, 500),
      row("2026-10-07", "Foreign_Dealer_Self", 0, 0),
      row("2026-10-08", "Foreign_Investor", 9999, 0),
      row("2026-10-08", "Foreign_Dealer_Self", 0, 0),
    ],
    "2026-10-06",
    "2026-10-07",
  );
  assert.equal(foreign(result).value, 380);
  assert.deepEqual(
    result.history.foreign.map((p) => p.value),
    [780, -400],
  );
  assert.equal(result.details.institutions[0].foreign, -400);
});

test("新制缺少類別或買賣值不能當成零；明確的零有效", () => {
  for (const extra of [
    [],
    [row("2026-10-08", "Foreign_Dealer_Self", null, 0)],
  ]) {
    const result = summary(
      [row("2026-10-08", "Foreign_Investor", 100, 50), ...extra],
      "2026-10-08",
      "2026-10-08",
    );
    assert.equal(foreign(result).value, null);
  }
  const result = summary(
    [
      row("2026-10-08", "Foreign_Investor", 100, 50),
      row("2026-10-08", "Foreign_Dealer_Self", 0, 0),
    ],
    "2026-10-08",
    "2026-10-08",
  );
  assert.equal(foreign(result).value, 50);
});

test("上市上櫃依各自新制日期處理，舊制外資不重複加總", () => {
  for (const [market, before, after] of [
    ["TWSE", "2017-12-15", "2017-12-18"],
    ["TPEX", "2018-01-12", "2018-01-15"],
  ]) {
    const rows = [
      row(before, "Foreign_Investor", 100, 20),
      row(before, "Foreign_Dealer_Self", 40, 0),
      row(after, "Foreign_Investor", 200, 10),
      row(after, "Foreign_Dealer_Self", 20, 5),
    ];
    assert.equal(foreign(summary(rows, before, after, market)).value, 285);
    assert.equal(
      foreign(
        summary(
          [row(after, "Foreign_Investor", 200, 10)],
          after,
          after,
          market,
        ),
      ).value,
      null,
    );
  }
});
