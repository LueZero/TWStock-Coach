import test from "node:test";
import assert from "node:assert/strict";
import { holdingBands, buildChipWorkspace } from "../api/chip-workspace.js";
import { parseOwnership, rocDate } from "../api/ownership-provider.js";

test("集保門檻按完整級距加總，前期觀測可在區間外，缺級距不補零", () => {
  const levels = [
    "1-999",
    "1000-5000",
    "5001-10000",
    "10001-15000",
    "15001-20000",
    "20001-30000",
    "30001-40000",
    "40001-50000",
    "400001-600000",
    "600001-800000",
    "800001-1000000",
    "morethan1000000",
  ];
  const rows = ["2026-09-25", "2026-10-02"].flatMap((date, i) =>
    levels.map((HoldingSharesLevel) => ({
      date,
      HoldingSharesLevel,
      percent: 1 + i,
    })),
  );
  const bands = holdingBands(rows);
  assert.equal(bands[1].small20, 10);
  assert.equal(bands[1].small50, 16);
  assert.equal(bands[1].large400, 8);
  assert.equal(bands[1].large1000, 2);
  assert.equal(
    holdingBands(rows.filter((r) => r.HoldingSharesLevel !== "1000-5000"))[1]
      .small20,
    null,
  );
  const result = buildChipWorkspace(
    { TaiwanStockHoldingSharesPer: rows },
    "2026-10-01",
    "2026-10-08",
    [],
  );
  assert.equal(result.ownership.length, 1);
  assert.equal(result.ownership[0].large400_change, 4);
});

test("法人合計保留缺值；分點按同日同分點聚合；融資餘額與限額統一股數", () => {
  const data = {
    TaiwanStockTradingDailyReport: [
      {
        date: "2026-10-08",
        securities_trader_id: "A",
        securities_trader: "分點A",
        buy: 10,
        sell: 3,
      },
      {
        date: "2026-10-08",
        securities_trader_id: "A",
        securities_trader: "分點A",
        buy: 20,
        sell: 5,
      },
    ],
    TaiwanStockMarginPurchaseShortSale: [
      {
        date: "2026-10-08",
        MarginPurchaseTodayBalance: 100,
        MarginPurchaseYesterdayBalance: 90,
        MarginPurchaseLimit: 200,
        ShortSaleTodayBalance: 20,
        ShortSaleYesterdayBalance: 25,
        ShortSaleLimit: 100,
        OffsetLoanAndShort: 3,
      },
    ],
  };
  const result = buildChipWorkspace(
    data,
    "2026-10-08",
    "2026-10-08",
    [{ date: "2026-10-08", foreign: 10, trust: null, dealer: 5 }],
    [{ trade_date: "2026-10-08", close: 30, volume: 30000 }],
  );
  assert.equal(result.institutions[0].total, null);
  assert.equal(result.branches[0].net, 22);
  assert.equal(result.margin[0].margin_balance, 100000);
  assert.equal(result.margin[0].margin_change, 10000);
  assert.equal(result.margin[0].short_change, -5000);
  assert.equal(result.margin[0].margin_usage, 50);
  assert.equal(result.margin[0].short_margin_ratio, 20);
  assert.equal(result.margin[0].offset_ratio, 10);
});

test("集中度用完整交易日暖機，缺漏交易日使5日值留空", () => {
  const prices = Array.from({ length: 5 }, (_, i) => ({
    trade_date: `2026-10-0${i + 1}`,
    close: 20,
    volume: 1000,
  }));
  const concentration = prices.map((p) => ({
    date: p.trade_date,
    top_buy_volume: 200,
    top_sell_volume: 100,
  }));
  const result = buildChipWorkspace(
    { TaiwanStockBrokerDailyConcentration: concentration },
    "2026-10-05",
    "2026-10-05",
    [],
    prices,
  );
  assert.equal(result.main.length, 1);
  assert.equal(result.main[0].concentration5, 10);
  assert.equal(result.main[0].concentration20, null);
  assert.equal(
    buildChipWorkspace(
      { TaiwanStockBrokerDailyConcentration: concentration.slice(1) },
      "2026-10-05",
      "2026-10-05",
      [],
      prices,
    ).main[0].concentration5,
    null,
  );
});

test("基金零持股不列持有，權重變動使用同一基金前月最後觀測", () => {
  const data = {
    FundHoldingsReport: [
      {
        date: "2026-09-30",
        fund_code: "A",
        holding_shares: 100,
        weight_percent: 2,
      },
      {
        date: "2026-10-08",
        fund_code: "A",
        holding_shares: 200,
        weight_percent: 3,
      },
      {
        date: "2026-10-08",
        fund_code: "B",
        holding_shares: 0,
        weight_percent: 0,
      },
    ],
  };
  const result = buildChipWorkspace(data, "2026-10-01", "2026-10-08", []);
  assert.equal(result.funds.length, 1);
  assert.equal(result.funds[0].weight_change, 1);
  assert.equal(result.funds[0].comparison_date, "2026-09-30");
});

test("上市上櫃揭露名稱差異、民國日期、空白值與法人代表去重", () => {
  assert.equal(rocDate("11508"), "2026-08-01");
  assert.throws(() => rocDate("1151332"));
  const rows = parseOwnership(
    [
      {
        公司代號: "2409",
        資料年月: "11508",
        出表日期: "1150918",
        職稱: "董事之法人代表人",
        姓名: "甲",
        目前持股: "1,000",
        設質股數: "",
        設質股數佔持股比例: "0.00%",
      },
    ],
    "2409",
    "DirectorHoldingsReport",
    "https://example.com",
  );
  assert.equal(rows[0].holding_shares, 1000);
  assert.equal(rows[0].pledge_shares, null);
  assert.equal(rows[0].aggregate_eligible, false);
  const events = parseOwnership(
    [
      {
        SecuritiesCompanyCode: "6488",
        Date: "1151008",
        申請人身分: "董事本人",
        姓名: "乙",
        "預定轉讓總股數-自有持股": "200000",
        "預定轉讓總股數-保留運用決定權信託股數": "0",
      },
    ],
    "6488",
    "InsiderTransfersReport",
    "https://example.com",
  );
  assert.equal(events[0].transfer_shares, 200000);
  assert.equal(events[0].date, "2026-10-08");
  assert.equal(events[0].role, "董事本人");
});
