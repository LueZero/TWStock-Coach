import test from "node:test";
import assert from "node:assert/strict";
import {
  tdccForm,
  parseTdccWeek,
  tdccHistory,
  clearTdccHistoryCache,
  TDCC_HISTORY_URL,
} from "../../api/tdcc-history.js";
import {
  parseCathayStocks,
  parseCathayQuarter,
  cathayFunds,
  cathayPortfolio,
  cathayQuarterly,
} from "../../api/cathay-funds.js";
import { clearSourceCache } from "../../api/source-cache.js";
const dates = ["2026-11-20", "2026-11-13", "2026-11-06"];
const levels = [
  "1-999",
  "1,000-5,000",
  "5,001-10,000",
  "10,001-15,000",
  "15,001-20,000",
  "20,001-30,000",
  "30,001-40,000",
  "40,001-50,000",
  "50,001-100,000",
  "100,001-200,000",
  "200,001-400,000",
  "400,001-600,000",
  "600,001-800,000",
  "800,001-1,000,000",
  "1,000,001以上",
];
function page(date = "2026-11-20", symbol = "2409", bad = false) {
  const form = `<input name="SYNCHRONIZER_TOKEN" value="test-csrf"><input name="SYNCHRONIZER_URI" value="/portal/zh/smWeb/qryStock"><input name="firDate" value="20261120"><select name="scaDate">${dates.map((d) => `<option value="${d.replaceAll("-", "")}">${d}</option>`).join("")}</select>`;
  if (!date) return form;
  const [y, m, d] = date.split("-");
  const rows = levels
    .map(
      (l, i) =>
        `<tr><td>${i + 1}</td><td>${l}</td><td>10</td><td>${bad && i === 0 ? "999" : "1,000"}</td><td>6.66</td></tr>`,
    )
    .join("");
  return (
    form +
    `<p>證券代號：${symbol}</p><span>資料日期：${Number(y) - 1911}年${Number(m)}月${Number(d)}日</span><table class="table"><tr><th>序</th></tr>${rows}<tr><td>16</td><td>差異數調整（說明4）</td><td></td><td>0</td><td>-0.00</td></tr><tr><td>17</td><td>合　計</td><td>150</td><td>15,000</td><td>100.00</td></tr></table>`
  );
}
test("集保依官方日期選單，不猜週五；解析完整級距與差異數空值", () => {
  const h = page();
  assert.deepEqual(tdccForm(h).dates, dates);
  const rows = parseTdccWeek(h, "2409", "2026-11-20");
  assert.equal(rows.length, 17);
  assert.equal(
    rows.find((r) => r.HoldingSharesLevel === "差異數").people,
    null,
  );
  assert.equal(rows[0].unit, 1000);
  assert.throws(() => parseTdccWeek(h, "2883", "2026-11-20"));
  assert.throws(() => parseTdccWeek(h, "2409", "2026-11-13"));
  assert.throws(
    () => parseTdccWeek(page("2026-11-20", "2409", true), "2409", "2026-11-20"),
    /合計/,
  );
});
test("集保歷史逐週發布進度、重用已核對週快取，不呼叫付費來源", async (t) => {
  clearTdccHistoryCache();
  let posts = 0;
  const progress = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, TDCC_HISTORY_URL);
    if (options.method === "GET") return new Response(page(null));
    posts++;
    const body = new URLSearchParams(options.body);
    assert.equal(body.get("SYNCHRONIZER_TOKEN"), "test-csrf");
    const d = body.get("scaDate");
    return new Response(
      page(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`),
    );
  });
  const r = await tdccHistory("2409", "2026-11-01", "2026-11-20", (rows) =>
    progress.push(rows.length),
  );
  assert.equal(r.data.length, 51);
  assert.deepEqual(progress, [17, 34, 51]);
  assert.equal(r.coverage.loaded_weeks, 3);
  assert.equal(posts, 3);
  await tdccHistory("2409", "2026-11-01", "2026-11-20");
  assert.equal(posts, 3);
  const empty = await tdccHistory("2409", "2025-01-01", "2025-02-01");
  assert.equal(empty.coverage.requested_weeks, 0);
  assert.equal(empty.data.length, 0);
  clearTdccHistoryCache();
  posts = 0;
  await Promise.all([
    tdccHistory("2409", "2026-11-01", "2026-11-20"),
    tdccHistory("2409", "2026-11-13", "2026-11-20"),
  ]);
  assert.equal(posts, 3, "重疊區間的同股同週請求應合併");
});
test("集保日期錯置不污染歷史，保留已成功週與失敗週", async (t) => {
  clearTdccHistoryCache();
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    if (opts.method === "GET") return new Response(page(null));
    return new Response(page());
  });
  const r = await tdccHistory("2409", "2026-11-13", "2026-11-20");
  assert.equal(r.coverage.loaded_weeks, 1);
  assert.deepEqual(r.coverage.failed_weeks, ["2026-11-13"]);
  assert.ok(r.data.every((r) => r.date === "2026-11-20"));
});
const fund = { fundCode: "CN", stockNo: "00878", shortName: "國泰永續高股息" };
const success = (result) => ({ returnCode: "2000", success: true, result });
test("國泰日組合依來源股數欄位，不乘1000、不虛構適用日", () => {
  const rows = parseCathayStocks(
    success([
      {
        stockCode: "2891",
        stockName: "中信金",
        volumn: "950,539,000",
        weights: "11.45",
      },
    ]),
    fund,
    "2026-11-20",
  );
  assert.equal(rows[0].holding_shares, 950539000);
  assert.equal(rows[0].effective_date, null);
  assert.equal(rows[0].basis, "issuer_daily_portfolio");
  assert.throws(() =>
    parseCathayStocks(
      success([{ stockCode: "2891", volumn: "bad", weights: "11" }]),
      fund,
      "2026-11-20",
    ),
  );
});
test("國泰季度僅權重，保留產業與名稱，不猜代號或反推股數", () => {
  const j = success({
    date: "2026/09",
    categoryDetailList: [
      {
        categoryName: "股票",
        industryDetailList: [
          {
            industryName: "金融",
            targetDetailList: [{ targetName: "中信金", proportion: 9.65 }],
          },
        ],
      },
    ],
  });
  const r = parseCathayQuarter(j, fund);
  assert.equal(r.date, "2026-09-30");
  assert.equal(r.rows[0].symbol, null);
  assert.equal(r.rows[0].holding_shares, null);
  assert.equal(r.rows[0].weight_percent, 9.65);
  assert.throws(() =>
    parseCathayQuarter(
      success({ date: "2026/08", categoryDetailList: [] }),
      fund,
    ),
  );
});
test("國泰目錄核對完整分頁，組合依資產估值日發出查詢", async (t) => {
  clearSourceCache();
  t.mock.method(globalThis, "fetch", async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith("GetETFList"))
      return Response.json({
        ...success([
          { fundCode: "CN", stockCode: "00878", stockShortNameFix: "ETF" },
        ]),
        totalCount: 1,
      });
    assert.equal(u.searchParams.get("FundCode"), "CN");
    if (u.pathname.endsWith("GetETFAssets"))
      return Response.json(success({ preDate: "2026/11/20" }));
    assert.equal(u.searchParams.get("SearchDate"), "2026-11-20");
    return Response.json(
      success([
        {
          stockCode: "2891",
          stockName: "中信金",
          volumn: "1000",
          weights: "1",
        },
      ]),
    );
  });
  const list = await cathayFunds();
  const p = await cathayPortfolio(list[0]);
  assert.equal(p.date, "2026-11-20");
  assert.equal(p.rows.length, 1);
  clearSourceCache();
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ ...success([]), totalCount: 41 }),
  );
  await assert.rejects(cathayFunds(), /完整分頁/);
});
test("已核對基金的季度來源明示查無資料，不標成網路錯誤", async (t) => {
  clearSourceCache();
  t.mock.method(globalThis, "fetch", async (url) =>
    Response.json(
      String(url).includes("GetETFList")
        ? {
            ...success([
              { fundCode: "CN", stockCode: "00878", stockShortNameFix: "ETF" },
            ]),
            totalCount: 1,
          }
        : { success: false, returnCode: "4005", result: null },
    ),
  );
  const r = await cathayQuarterly("00878", "2026-11-21");
  assert.equal(r.status, "no_data");
  assert.equal(r.rows.length, 0);
});
