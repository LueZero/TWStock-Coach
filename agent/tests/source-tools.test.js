import test from "node:test";
import assert from "node:assert/strict";
import { createSourceTools } from "../source-tools.js";
import { createAssistantTools } from "../assistant-tools.js";

function harness(handler, mode = "latest") {
  const requests = [],
    calls = [];
  const context = {
    api_url: "http://localhost:8000",
    user_message: "成本40一張",
    scope: {
      market: "TWSE",
      symbol: "00927",
      mode,
      as_of: "2026-11-22T01:00:00Z",
      start: "2026-05-22",
      end: "2026-11-22",
    },
  };
  const fetcher = async (url, options) => {
    const parsed = new URL(url);
    requests.push({
      path: parsed.pathname,
      query: parsed.searchParams,
      body: options.body ? JSON.parse(options.body) : null,
    });
    assert.ok(
      !/report-input|refresh|load|ingest|jobs/.test(parsed.pathname),
      "Chat不得呼叫整包報告與舊寫入工作",
    );
    return Response.json(await handler(parsed, options));
  };
  return {
    context,
    requests,
    calls,
    fetcher,
    tools: createSourceTools(context, {
      fetcher,
      onCall: (call) => calls.push(call),
    }),
  };
}

test("基本、財務、籌碼直接讀獨立API；載入中不凍結為永久空資料", async () => {
  let count = 0;
  const h = harness((url) => {
    if (url.pathname.includes("stock-data"))
      return { data: { profile: { name: "基金" } }, state: "ready" };
    if (url.pathname.includes("fundamentals"))
      return ++count === 1
        ? {
            metrics: [],
            source_status: "updating",
            coverage: [{ status: "queued" }],
          }
        : {
            metrics: [
              { key: "eps", value: 1.5, period: "2026-09-30", unit: "元" },
            ],
            history: {
              eps: [
                { period: "2024-03-31", value: 1 },
                { period: "2026-09-30", value: 1.5 },
              ],
            },
            source_status: "ready",
          };
    if (url.pathname.includes("equity"))
      return {
        workspace: {
          institutions: [{ date: "2026-11-20", foreign: 1000 }],
          branches: [],
          definitions: { main: "代理" },
        },
        coverage: [{ dataset: "branch", status: "permission_denied" }],
        source_status: "partial",
      };
    throw Error("意外路由");
  });
  await h.tools.call("get_stock_data", { section: "basic" });
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].query.get("section"), "basic");
  const waiting = await h.tools.call("get_stock_data", {
    section: "financial",
    wait_ms: 0,
  });
  assert.equal(waiting.data.source_status, "updating");
  const full = await h.tools.call("get_financial_history", { metric: "eps" });
  assert.equal(full.data.history.total, 2, "預設半年不裁掉財報歷史");
  assert.equal(
    h.requests.filter((r) => r.path.includes("fundamentals")).length,
    2,
  );
  const detail = await h.tools.call("get_financial_history", {
    metric: "eps",
    start: "2026-01-01",
  });
  assert.equal(detail.data.history.total, 1);
  const chips = await h.tools.call("get_chip_detail", {});
  assert.ok(chips.data.catalogue.some((row) => row.id === "institutions"));
  assert.equal(chips.data.coverage[0].status, "permission_denied");
  const rows = await h.tools.call("get_chip_detail", {
    dataset: "institutions",
  });
  assert.equal(rows.data.dataset.rows[0].foreign, 1000);
  assert.ok(h.requests.every((r) => !r.query.has("as_of")));
  assert.ok(
    h.calls.every(
      (c) => c.database_used === false && c.point_in_time === false,
    ),
  );
});

test("技術暖機、完成K與分頁不含截止後資料；可繪圖資料仍按時間升序", async () => {
  const h = harness(() => ({
    source_state: "ready",
    data: [
      {
        trade_date: "2026-05-20",
        timestamp: "2026-05-20T05:30:00Z",
        close: 30,
        is_final: true,
      },
      {
        trade_date: "2026-11-19",
        timestamp: "2026-11-19T05:30:00Z",
        close: 39,
        is_final: true,
      },
      {
        trade_date: "2026-11-20",
        timestamp: "2026-11-20T05:30:00Z",
        close: 40,
        analysis: { ma5: 39.5 },
        is_final: true,
      },
      {
        trade_date: "2026-11-22",
        timestamp: "2026-11-22T05:30:00Z",
        close: 99,
        is_final: false,
      },
      {
        trade_date: "2026-11-23",
        timestamp: "2026-11-23T05:30:00Z",
        close: 999,
        is_final: true,
      },
    ],
  }));
  const first = await h.tools.call("get_stock_data", {
    section: "technical",
    limit: 1,
  });
  assert.equal(first.data.bars.rows[0].close, 40);
  assert.equal(
    first.data.metrics.ma5,
    39.5,
    "沿用看盤API的暖機指標，不在工具重算",
  );
  assert.equal(first.data.bars.total, 2);
  assert.equal(first.data.bars.has_more, true);
  assert.equal(first.data.meta.asset, "etf");
  assert.equal(h.requests[0].query.get("start"), h.context.scope.start);
  const old = await h.tools.call("get_stock_data", {
    section: "technical",
    limit: 1,
    offset: 1,
  });
  assert.equal(old.data.bars.rows[0].close, 39);
  assert.equal(old.data.bars.has_more, false);
  await assert.rejects(
    h.tools.call("get_stock_data", { section: "technical", end: "2026-11-23" }),
    /日期/,
  );
});

test("基金及估值保留分頁、來源狀態與估值日，回放使用明確費用假設", async () => {
  const h = harness((url) => ({
    status: "outside_range",
    data_date: "2026-11-20",
    rows: [
      { shares: null, weight: 1 },
      { shares: null, weight: 2 },
    ],
  }));
  const fund = await h.tools.call("get_fund_data", {
    section: "quarterly",
    limit: 1,
  });
  assert.equal(fund.data.status, "outside_range");
  assert.equal(fund.data.rows.has_more, true);
  assert.equal(fund.data.rows.rows[0].shares, null);
  assert.equal(h.requests[0].query.get("section"), "quarterly");
  await h.tools.call("get_valuation_bands", { field: "PER" });
  assert.equal(h.requests[1].query.get("field"), "PER");
  await h.tools.call("run_strategy_backtest", {
    start: "2026-11-01",
    end: "2026-11-20",
    fee_bps: 5,
    slippage_bps: 3,
    sell_tax_bps: 10,
  });
  assert.equal(h.requests[2].body.sell_tax_bps, 10);
  assert.equal(h.requests[2].body.price_basis, "raw");
  await assert.rejects(
    h.tools.call("run_strategy_backtest", {
      start: "2026-11-01",
      end: "2026-11-20",
      fee_bps: 101,
      slippage_bps: 3,
      sell_tax_bps: 10,
    }),
    /參數/,
  );
});

test("新聞預設七日，可依next_cursor繼續，錯誤日期與過大範圍被拒絕", async () => {
  const h = harness((url) => ({
    next_cursor: "2026-11-17",
    news: [{ title: "索引" }],
    source_date:
      url.searchParams.get("cursor") || url.searchParams.get("start"),
  }));
  await h.tools.call("get_stock_data", { section: "news" });
  assert.equal(h.requests[0].query.get("start"), "2026-11-16");
  await h.tools.call("get_stock_data", {
    section: "news",
    source: "index",
    cursor: "2026-11-17",
  });
  assert.equal(h.requests[1].query.get("cursor"), "2026-11-17");
  await assert.rejects(
    h.tools.call("get_stock_data", { section: "news", start: "2026-09-01" }),
    /31日/,
  );
  await assert.rejects(
    h.tools.call("get_stock_data", { section: "news", cursor: "2026-02-30" }),
    /cursor/,
  );
});

test("同業財務載入後可重查比較，不保留本輪早先的空結果", async () => {
  let count = 0;
  const h = harness(() => ({ rows: [{ available: count++ }] }));
  const a = await h.tools.call("get_stock_data", {
    section: "peers",
    symbols: "TWSE:2330,TWSE:2303",
  });
  const b = await h.tools.call("get_stock_data", {
    section: "peers",
    symbols: "TWSE:2330,TWSE:2303",
  });
  assert.notEqual(a.data.rows.rows[0].available, b.data.rows.rows[0].available);
  assert.notEqual(a.evidence_id, b.evidence_id);
});

test("歷史當時快照不以最新財務/籌碼/報價替代，來源錯誤可重試", async () => {
  const h = harness(() => {
    throw Error("不得查來源");
  }, "historical");
  for (const section of ["financial", "chips", "news", "basic"]) {
    const value = await h.tools.call("get_stock_data", { section });
    assert.equal(value.data.status, "historical_unavailable");
    assert.equal(value.data.available, false);
  }
  await assert.rejects(h.tools.quote(), /歷史/);
  assert.equal(h.requests.length, 0);
  let count = 0;
  const retry = harness(() => {
    if (!count++) throw Error("暫時異常");
    return { source_status: "ready", metrics: [] };
  });
  await assert.rejects(retry.tools.call("get_financial_history"), /連線中斷/);
  await retry.tools.call("get_financial_history");
  assert.equal(retry.requests.length, 2);
  assert.equal(retry.calls[0].status, "failed");
});

test("試算可用本次即時快照，行情失敗不阻擋有依據的價格試算", async () => {
  const h = harness((url) => {
    if (url.pathname.includes("quote")) return { last_price: 42 };
    throw Error("日K來源失敗");
  });
  const result = await h.tools.call("calculate_trade_profit", {
    buy_price: 40,
    buy_price_source: "user_cost",
    sell_price: 42,
    shares: 1000,
  });
  assert.equal(result.data.gross_profit, 2000);
  await assert.rejects(
    h.tools.call("calculate_trade_profit", {
      buy_price: 40,
      buy_price_source: "user_cost",
      sell_price: 99,
      shares: 1000,
    }),
    /不能自行編造/,
  );
});

test("大盤走勢不需選股，保留契約與盤別，不接收注入或超出歷史截止", async () => {
  const h = harness((url) => ({
    product: url.searchParams.get("product"),
    rows: [],
  }));
  const tools = createAssistantTools(h.context, { fetcher: h.fetcher });
  await tools.call("read_research_skill", { name: "twstock-evidence" });
  const value = await tools.call("get_market_chart", {
    product: "night",
    mode: "history",
    contract: "202611",
    start: "2026-11-01",
    end: "2026-11-20",
  });
  assert.equal(value.data.product, "night");
  assert.equal(h.requests[0].path, "/api/market/board/chart");
  assert.equal(h.requests[0].query.get("contract"), "202611");
  await assert.rejects(
    tools.call("get_market_chart", {
      product: "night",
      mode: "history",
      contract: "202613",
      start: "2026-11-01",
      end: "2026-11-20",
    }),
    /契約/,
  );
  await assert.rejects(
    tools.call("get_market_chart", {
      product: "night",
      mode: "intraday",
      symbol: "../../env",
    }),
    /symbol/,
  );
});
