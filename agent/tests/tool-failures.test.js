import test from "node:test";
import assert from "node:assert/strict";
import { createStockApiClient } from "../stock-api-client.js";
import { createAssistantTools } from "../assistant-tools.js";
import { createSourceTools } from "../source-tools.js";
import { createAgent } from "../server.js";
import { validateExplanation } from "../report-schema.js";
import { validationReport } from "../report-validation.js";

test("來源小數顯示捨入可保存，但不能冒充合法下單價或任意新價位", () => {
  const report = validationReport(
    [
      {
        status: "completed",
        evidence_id: "technical",
        arguments: { section: "technical" },
        data: {
          meta: { asset: "stock" },
          metrics: { ma20: 28.434999999999995 },
          bars: { rows: [] },
        },
      },
    ],
    {},
    "",
  );
  const draft = (answer) => ({
    answer,
    highlights: [],
    scenario_ids: [],
    cautions: [],
  });
  assert.doesNotThrow(() =>
    validateExplanation(draft("20 日線28.44元。"), report),
  );
  assert.doesNotThrow(() =>
    validateExplanation(draft("參考價位28.44元。"), report),
  );
  assert.throws(
    () => validateExplanation(draft("買入28.44元。"), report),
    /非平台/,
  );
  assert.throws(
    () => validateExplanation(draft("參考價位28.49元。"), report),
    /非平台/,
  );
});

test("財報淨利與每股虧損可引用來源，不誤要求個人損益試算", () => {
  const report = validationReport(
    [
      {
        status: "completed",
        evidence_id: "finance",
        arguments: { section: "financial" },
        data: {
          metrics: [
            { key: "eps", value: -0.33 },
            { key: "net_amount", value: -100 },
          ],
        },
      },
    ],
    {},
    "",
  );
  const draft = (answer) => ({
    answer,
    highlights: [],
    scenario_ids: [],
    cautions: [],
  });
  assert.doesNotThrow(() =>
    validateExplanation(
      draft("公司第三季每股虧損0.33元；稅後淨利-100元。"),
      report,
    ),
  );
  assert.throws(
    () => validateExplanation(draft("公司第三季每股虧損0.55元。"), report),
    /非平台/,
  );
  assert.throws(
    () => validateExplanation(draft("我這筆持倉淨利100元。"), report),
    /非平台/,
  );
});

const context = {
  api_url: "http://127.0.0.1:8000",
  scope: {
    mode: "latest",
    market: "TWSE",
    symbol: "2409",
    as_of: "2026-11-24T01:00:00Z",
    start: "2026-10-01",
    end: "2026-11-24",
  },
};
const refused = () => {
  throw Object.assign(Error("fetch failed secret-token"), {
    cause: { code: "ECONNREFUSED" },
  });
};
test("大盤單一來源失敗仍可取得另一面向，不把局部失敗當全服務離線", async () => {
  const paths = [];
  const tools = createAssistantTools(context, {
    fetcher: (url) => {
      const path = new URL(url).pathname;
      paths.push(path);
      return path.endsWith("/board")
        ? new Response("{}", { status: 503 })
        : Response.json({ available: true, date: "2026-11-23" });
    },
  });
  await tools.call("read_research_skill", { name: "twstock-evidence" });
  const result = await tools.call("get_market_data");
  assert.equal(result.data.source_status, "partial");
  assert.equal(result.data.board.available, false);
  assert.equal(result.data.chips.available, true);
  assert.equal(paths.length, 2);
});
test("API拒絕、DNS、逾時、HTTP及格式錯誤可辨識且不洩漏原始錯誤", async () => {
  for (const [cause, code] of [
    ["ECONNREFUSED", "STOCK_API_UNREACHABLE"],
    ["ENOTFOUND", "STOCK_API_DNS"],
    ["ETIMEDOUT", "STOCK_API_TIMEOUT"],
  ]) {
    const client = createStockApiClient(context.api_url, {
      fetcher: () => {
        throw Object.assign(Error("secret"), { cause: { code: cause } });
      },
    });
    await assert.rejects(
      client.request("/api/search?q=secret"),
      (error) => error.code === code && !error.message.includes("secret"),
    );
    assert.equal((await client.health()).ready, false);
  }
  for (const [response, code] of [
    [new Response("private body", { status: 503 }), "STOCK_API_HTTP"],
    [new Response("not json"), "STOCK_API_FORMAT"],
  ]) {
    const client = createStockApiClient(context.api_url, {
      fetcher: () => response,
    });
    await assert.rejects(
      client.request("/api/search?q=secret"),
      (error) => error.code === code && !/private|secret/.test(error.message),
    );
  }
});
test("離線時搜尋、大盤、篩選、選股前失敗與參數錯誤都留下audit", async () => {
  const calls = [];
  const tools = createAssistantTools(context, {
    fetcher: refused,
    onCall: (call) => calls.push(call),
  });
  const status = await tools.call("get_stock_service_status");
  assert.equal(status.code, "STOCK_API_UNREACHABLE");
  await tools.call("read_research_skill", { name: "twstock-evidence" });
  for (const [name, args] of [
    ["search_stocks", { query: "2409" }],
    ["get_market_data", {}],
    ["screen_market_stocks", {}],
    ["get_stock_data", { market: "TWSE", symbol: "2409", section: "basic" }],
  ])
    await assert.rejects(
      tools.call(name, args),
      (error) => error.code === "STOCK_API_UNREACHABLE",
    );
  assert.equal(calls.filter((c) => c.status === "failed").length, 4);
  assert.ok(
    calls
      .filter((c) => c.status === "failed")
      .every((c) => c.error_code === "STOCK_API_UNREACHABLE"),
  );
  await assert.rejects(tools.call("get_stock_data", { section: "basic" }));
  assert.equal(calls.at(-1).status, "failed");
});
test("並行同工具失敗各自記錄一次，不能遺漏或重複", async () => {
  const calls = [];
  const tools = createAssistantTools(context, {
    onCall: (call) => calls.push(call),
    fetcher: (url) =>
      new URL(url).pathname === "/api/search"
        ? Response.json([{ market: "TWSE", symbol: "2409", name: "友達" }])
        : refused(),
  });
  await tools.call("read_research_skill", { name: "twstock-evidence" });
  await tools.call("search_stocks", { query: "2409" });
  await Promise.allSettled([
    tools.call("get_stock_data", {
      market: "TWSE",
      symbol: "2409",
      section: "basic",
    }),
    tools.call("get_stock_data", {
      market: "TWSE",
      symbol: "2409",
      section: "technical",
    }),
  ]);
  assert.equal(calls.filter((c) => c.status === "failed").length, 2);
  assert.deepEqual(
    new Set(
      calls
        .filter((c) => c.status === "failed")
        .map((c) => c.arguments.section),
    ),
    new Set(["basic", "technical"]),
  );
});
test("冷財務有限等待後有值；仍載入的metric查詢保留狀態而非不存在", async () => {
  let count = 0;
  const tools = createSourceTools(context, {
    fetcher: () =>
      Response.json(
        ++count === 1
          ? { source_status: "updating", metrics: [] }
          : {
              source_status: "ready",
              metrics: [{ key: "eps", value: 2, period: "2026-09-30" }],
              history: { eps: [{ value: 2, period: "2026-09-30" }] },
            },
      ),
  });
  const result = await tools.call("get_financial_history", {
    metric: "eps",
    wait_ms: 1000,
  });
  assert.equal(result.data.metric.value, 2);
  assert.equal(result.data.source_status, "ready");
  const pending = createSourceTools(context, {
    fetcher: () => Response.json({ source_status: "updating", metrics: [] }),
  });
  const waiting = await pending.call("get_financial_history", {
    metric: "eps",
    wait_ms: 0,
  });
  assert.equal(waiting.data.source_status, "updating");
  assert.equal(waiting.data.history.total, 0);
});
test("財務細項與籌碼別名可查，最新頁與權限限制保留", async () => {
  const tools = createSourceTools(context, {
    fetcher: (url) =>
      Response.json(
        new URL(url).pathname.includes("fundamentals")
          ? {
              source_status: "ready",
              catalog: {
                groups: [
                  { pages: [{ id: "income-statement", keys: ["net_amount"] }] },
                ],
              },
              metrics: [{ key: "net_amount", value: 3, period: "2026-09-30" }],
              history: {
                net_amount: [
                  { period: "2025-03-31", value: 1 },
                  { period: "2026-09-30", value: 3 },
                ],
              },
            }
          : {
              source_status: "partial",
              workspace: {
                institutions: [
                  { date: "2026-10-01", foreign: 1 },
                  { date: "2026-11-20", foreign: 2 },
                ],
                branches: [],
              },
              coverage: [
                {
                  dataset: "TaiwanStockInstitutionalInvestorsBuySell",
                  status: "available",
                },
                {
                  dataset: "TaiwanStockTradingDailyReport",
                  status: "permission_denied",
                },
              ],
            },
      ),
  });
  const page = await tools.call("get_financial_history", {
    page: "income-statement",
    limit: 1,
  });
  assert.equal(page.data.history.net_amount.rows[0].value, 3);
  assert.equal(page.data.history.net_amount.has_more, true);
  const detail = await tools.call("get_chip_detail", {
    dataset: "TaiwanStockInstitutionalInvestorsBuySell",
    limit: 1,
  });
  assert.equal(detail.data.dataset.rows[0].foreign, 2);
  const catalogue = await tools.call("get_chip_detail", {});
  assert.equal(
    catalogue.data.catalogue.find((c) => c.id === "branches").status,
    "permission_denied",
  );
});
test("狀態頁分開呈現Codex可用與股票API離線，不阻擋純概念對話", async () => {
  const app = createAgent({
    accessKey: "test-key-12345678901234567890",
    health: async () => ({ ready: true }),
    stockHealth: async () => ({
      ready: false,
      code: "STOCK_API_UNREACHABLE",
      note: "API未啟動",
    }),
  });
  try {
    const login = await app.inject({
      method: "POST",
      url: "/api/assistant/login",
      payload: { access_key: "test-key-12345678901234567890" },
    });
    const result = await app.inject({
      url: "/api/assistant/status",
      headers: { cookie: login.headers["set-cookie"].split(";")[0] },
    });
    assert.equal(result.json().ready, true);
    assert.equal(result.json().stock_api.ready, false);
  } finally {
    await app.close();
  }
});
