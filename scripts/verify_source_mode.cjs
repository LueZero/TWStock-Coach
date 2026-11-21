// Verifies the real source API UI without a stock database or preloaded data.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  scratch = path.join(root, ".tmp");
fs.mkdirSync(scratch, { recursive: true });
const base = process.env.BASE_URL || "http://127.0.0.1:5173";
const child = spawn(
  process.env.CHROME_PATH ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  [
    "--headless=new",
    "--remote-debugging-port=9224",
    `--user-data-dir=${path.join(scratch, "source-browser-profile")}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ],
  { stdio: "ignore", windowsHide: true },
);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let ws,
  session,
  id = 0;
const pending = new Map(),
  errors = [];
async function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const key = ++id,
      timer = setTimeout(() => {
        pending.delete(key);
        reject(Error("CDP timeout " + method));
      }, 20000);
    pending.set(key, { resolve, reject, timer });
    ws.send(
      JSON.stringify({
        id: key,
        method,
        params,
        ...(session ? { sessionId: session } : {}),
      }),
    );
  });
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails)
    throw Error(
      r.exceptionDetails.exception?.description || r.exceptionDetails.text,
    );
  return r.result.value;
}
async function until(expression, timeout = 180000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await evaluate(expression)) return;
    await pause(500);
  }
  throw Error(
    "UI wait failed: " +
      expression +
      " " +
      (await evaluate('document.getElementById("historyStatus").textContent')),
  );
}
(async () => {
  try {
    let metadata;
    for (let i = 0; i < 60; i++) {
      try {
        metadata = await (
          await fetch("http://127.0.0.1:9224/json/version")
        ).json();
        break;
      } catch {
        await pause(150);
      }
    }
    assert.ok(metadata);
    ws = new WebSocket(metadata.webSocketDebuggerUrl);
    await new Promise((r, j) => {
      ws.onopen = r;
      ws.onerror = j;
    });
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.method === "Runtime.exceptionThrown")
        errors.push(m.params.exceptionDetails);
      const p = pending.get(m.id);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(m.id);
        m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
      }
    };
    const context = await send("Target.createBrowserContext"),
      target = await send("Target.createTarget", {
        url: "about:blank",
        browserContextId: context.browserContextId,
      });
    session = (
      await send("Target.attachToTarget", {
        targetId: target.targetId,
        flatten: true,
      })
    ).sessionId;
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send("Page.navigate", { url: base });
    await until('typeof globalThis.stockCoach?.selectSection==="function"');
    const health = await evaluate(
      '(async()=>await(await fetch("/health")).json())()',
    );
    assert.equal(health.database_used, false);
    await evaluate(
      'globalThis.stockCoach.selectSection("overview",false);document.getElementById("stockInput").value="2409";document.getElementById("searchForm").requestSubmit()',
    );
    // The persisted stock can already be 2409. Wait for this search to finish,
    // otherwise its eventual selectStock() resets the dates we are testing.
    await until(
      'globalThis.stockCoach.state.stock.symbol==="2409"&&document.getElementById("stockInput").value===""',
    );
    await evaluate(
      'document.getElementById("startDate").value="2026-10-01";document.getElementById("endDate").value="2026-10-08";document.getElementById("applyDates").click()',
    );
    await until(
      'globalThis.stockCoach.state.rows.length===6&&document.getElementById("historyStatus").textContent.includes("無 DB")',
    );
    assert.ok(
      await evaluate("globalThis.stockCoach.state.rows.every(r=>r.close>0)"),
    );
    await evaluate(
      'globalThis.stockCoach.selectSection("backtest",false);document.getElementById("runBacktest").click()',
    );
    await until(
      'document.getElementById("backtestMetrics").children.length>0&&document.getElementById("backtestStatus").textContent.includes("根完成")',
    );
    await evaluate('globalThis.stockCoach.selectSection("financial",false)');
    await until(
      '(async()=>{const r=await(await fetch("/api/stock-data/TWSE/2409?section=financial")).json();return r.state!=="updating";})()',
    );
    await evaluate('document.getElementById("refreshFinancials").click()');
    await until(
      'globalThis.stockCoach.state.financialData?.database_used===false&&globalThis.stockCoach.state.financialData.source_status==="ready"&&globalThis.stockCoach.state.financialData.metrics.some(m=>m.value!=null)',
    );
    const metrics = await evaluate(
      "globalThis.stockCoach.state.financialData.metrics.filter(m=>m.value!=null).length",
    );
    await evaluate(
      'document.querySelector("[data-financial-category=statements]").click();document.querySelector("[data-financial-page=nav]").click()',
    );
    await until(
      'document.getElementById("financialMetrics").textContent.includes("官方每股參考淨值")',
    );
    await evaluate(
      'document.querySelector("[data-financial-category=valuation]").click();document.querySelector("[data-financial-page=pb-band]").click()',
    );
    await until(
      'document.querySelectorAll("#financialMetrics .fund-research svg path").length>0',
    );
    const navigation = await evaluate(
      `(${async function () {
        const results = [];
        for (const view of [
          "overview",
          "technical",
          "basic",
          "financial",
          "chips",
          "backtest",
          "peers",
          "news",
        ]) {
          const start = performance.now();
          globalThis.stockCoach.selectSection(view, false);
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          results.push({
            view,
            paint_ms: Math.round(performance.now() - start),
          });
        }
        globalThis.stockCoach.selectSection("overview", false);
        return results;
      }.toString()})()`,
    );
    assert.ok(
      navigation.every((r) => r.paint_ms < 500),
      JSON.stringify(navigation),
    );
    const progressiveNews = await evaluate(
      `(${async function () {
        const original = globalThis.fetch;
        let release;
        const indexGate = new Promise((resolve) => {
          release = resolve;
        });
        const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        globalThis.fetch = async (input, options) => {
          const url = new URL(String(input), location.href);
          if (!url.pathname.startsWith("/api/media/"))
            return original(input, options);
          const recent = url.searchParams.get("source") === "recent";
          if (!recent) await indexGate;
          return Response.json({
            news: recent
              ? [
                  {
                    title: "近期文章先顯示驗證",
                    url: "https://example.com/verification",
                    published_at: "2026-11-19T10:00:00Z",
                    source: "驗證來源",
                    relation: "公司新聞",
                  },
                ]
              : [],
            discussions: [],
            sources: [
              {
                id: recent ? "yahoo" : "finmind",
                label: "驗證來源",
                available: true,
                count: recent ? 1 : 0,
              },
            ],
            failed_dates: [],
            next_cursor: null,
            notes: [],
            searches: [],
          });
        };
        try {
          globalThis.stockCoach.selectSection("news", false);
          document.getElementById("mediaStart").value = "2026-11-19";
          document.getElementById("mediaEnd").value = "2026-11-19";
          document.getElementById("mediaForm").requestSubmit();
          const deadline = performance.now() + 2000;
          while (
            !document
              .getElementById("companyNews")
              .textContent.includes("近期文章先顯示驗證") &&
            performance.now() < deadline
          )
            await pause(20);
          const shownBeforeIndex = document
            .getElementById("companyNews")
            .textContent.includes("近期文章先顯示驗證");
          release();
          await pause(100);
          return shownBeforeIndex;
        } finally {
          release();
          globalThis.fetch = original;
          globalThis.stockCoach.selectSection("overview", false);
        }
      }.toString()})()`,
    );
    assert.equal(progressiveNews, true, "近期文章必須在索引完成前顯示");
    await evaluate('globalThis.stockCoach.selectSection("chips",false)');
    await until(
      "globalThis.stockCoach.state.equityData?.database_used===false",
    );
    await evaluate(
      'document.getElementById("startDate").value="2026-11-01";document.getElementById("endDate").value="2026-11-20";document.getElementById("applyDates").click()',
    );
    await until(
      'globalThis.stockCoach.state.equityData?.start==="2026-11-01"&&globalThis.stockCoach.state.equityData?.end==="2026-11-20"&&globalThis.stockCoach.state.equityData.source_status!=="updating"&&globalThis.stockCoach.state.equityData.details.distribution.length>0',
    );
    const chipAvailability = await evaluate(
      `(${function () {
        const results = [];
        for (const tab of [
          "main-force",
          "broker",
          "major-holders",
          "shareholding-distribution",
          "insider-transactions",
          "fund-holdings",
        ]) {
          document.querySelector('[data-chip-tab="' + tab + '"]').click();
          results.push({
            tab,
            notice: document.getElementById("chipSummary").textContent,
            rows: document.getElementById("chipTableRows").children.length,
          });
        }
        return results;
      }.toString()})()`,
    );
    assert.equal(
      await evaluate(
        'globalThis.stockCoach.state.equityData.coverage.find(r=>r.dataset==="TaiwanStockHoldingSharesPer").source',
      ),
      "tdcc_history",
    );
    assert.ok(
      await evaluate(
        "new Set(globalThis.stockCoach.state.equityData.details.distribution.map(r=>r.date)).size>=3",
      ),
      "免費集保應取得區間多週，不只最新一週",
    );
    assert.ok(
      chipAvailability
        .filter((r) =>
          ["major-holders", "shareholding-distribution"].includes(r.tab),
        )
        .every((r) => r.rows > 0),
    );
    assert.ok(
      chipAvailability
        .find((r) => r.tab === "fund-holdings")
        .notice.includes("尚未接入"),
    );
    await evaluate(
      'globalThis.stockCoach.selectSection("overview",false);document.getElementById("stockInput").value="00927";document.getElementById("searchForm").requestSubmit()',
    );
    await until(
      'globalThis.stockCoach.state.stock.symbol==="00927"&&document.getElementById("stockInput").value===""',
    );
    await evaluate('globalThis.stockCoach.selectSection("basic",false)');
    await until(
      'document.getElementById("companyProfile").textContent.includes("基金類型")&&document.getElementById("companyProfile").textContent.includes("半導體")',
    );
    await evaluate('globalThis.stockCoach.selectSection("financial",false)');
    await until(
      'globalThis.stockCoach.state.financialData?.instrument_type==="etf"&&globalThis.stockCoach.state.financialData.dividends.length>0&&document.getElementById("financialSubpageSelect").value==="dividend-policy"',
    );
    await evaluate(
      'document.querySelector("[data-financial-category=profitability]").click()',
    );
    await until(
      'document.getElementById("financialSummary").textContent.includes("不適用 ETF")',
    );
    await evaluate(
      'document.querySelector("[data-financial-category=valuation]").click()',
    );
    await until(
      'document.getElementById("financialSubpageSelect").value==="etf-nav"&&document.querySelectorAll("#financialMetrics .fund-research svg path").length>0&&document.querySelectorAll("#financialMetrics .fund-research .research-card").length===4',
    );
    await evaluate(
      'document.querySelector("[data-financial-page=etf-portfolio]").click()',
    );
    await until(
      'document.querySelectorAll("#financialMetrics .fund-research table tr").length>=31',
    );
    const portfolioDay = await evaluate(
      '(async()=>{const r=await(await fetch("/api/fund-data/TWSE/00927?section=portfolio&end="+globalThis.stockCoach.state.range.end)).json();return r.date;})()',
    );
    assert.match(portfolioDay, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(
      await evaluate(
        'document.querySelectorAll("#financialMetrics .fund-research input[type=date]").length',
      ),
      1,
      "僅最新組合不應提供無效起始日欄位",
    );
    await evaluate(
      `document.querySelector("#financialMetrics .fund-research input[type=date]").value=${JSON.stringify(portfolioDay)};document.querySelector("#financialMetrics .fund-research button").click()`,
    );
    await until(
      'document.querySelectorAll("#financialMetrics .fund-research table tr").length>=31',
    );
    const priorDay = new Date(
      Date.parse(portfolioDay + "T00:00:00Z") - 86400000,
    )
      .toISOString()
      .slice(0, 10);
    await evaluate(
      `document.querySelector("#financialMetrics .fund-research input[type=date]").value=${JSON.stringify(priorDay)};document.querySelector("#financialMetrics .fund-research button").click()`,
    );
    await until(
      'document.getElementById("financialMetrics").textContent.includes("來源資料不在查詢範圍")',
    );
    assert.equal(
      await evaluate(
        'document.querySelectorAll("#financialMetrics .fund-research table").length',
      ),
      0,
      "區間外不應顯示誤導的零筆表格",
    );
    await evaluate(
      `document.querySelector("#financialMetrics .fund-research input[type=date]").value=${JSON.stringify(portfolioDay)};document.querySelector("#financialMetrics .fund-research button").click()`,
    );
    await until(
      'document.querySelectorAll("#financialMetrics .fund-research table tr").length>=31',
    );
    await send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: true,
    });
    assert.ok(
      await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),
      "ETF 組合不可撐出頁面寬度",
    );
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate('globalThis.stockCoach.selectSection("peers",false)');
    await until(
      'document.getElementById("peerNotes").textContent.includes("預估淨值")&&document.getElementById("peerRows").children.length>0',
    );
    await evaluate(
      'globalThis.stockCoach.selectSection("overview",false);document.getElementById("stockInput").value="00878";document.getElementById("searchForm").requestSubmit()',
    );
    await until(
      'globalThis.stockCoach.state.stock.symbol==="00878"&&document.getElementById("stockInput").value===""',
    );
    await evaluate('globalThis.stockCoach.selectSection("financial",false)');
    await until(
      'globalThis.stockCoach.state.financialData?.instrument_type==="etf"&&globalThis.stockCoach.state.financialData.source_status==="ready"',
    );
    await evaluate(
      'document.querySelector("[data-financial-category=valuation]").click();document.querySelector("[data-financial-page=etf-quarterly]").click()',
    );
    await until(
      'document.querySelectorAll("#financialMetrics .fund-research table tr").length>1',
    );
    assert.deepEqual(
      await evaluate(
        '[...document.querySelectorAll("#financialMetrics .fund-research th")].map(n=>n.textContent)',
      ),
      ["資產類別", "產業", "標的名稱", "占基金權重（%）"],
    );
    await evaluate('globalThis.stockCoach.selectSection("indices",false)');
    await until(
      'document.querySelectorAll(".market-board-card").length===3&&document.querySelectorAll("#boardChart path").length>0',
    );
    await evaluate('document.querySelector("[data-product=day]").click()');
    await until('document.getElementById("boardBookRows").children.length===5');
    const responsive = [];
    for (const width of [1440, 1024, 390, 320]) {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: width < 768,
      });
      await pause(200);
      const size = await evaluate(
        "({width:innerWidth,scroll:document.documentElement.scrollWidth})",
      );
      assert.ok(size.scroll <= size.width + 1, JSON.stringify(size));
      responsive.push(width);
    }
    assert.equal(errors.length, 0, JSON.stringify(errors));
    console.log(
      JSON.stringify({
        status: "passed",
        database_used: false,
        stock: "2409",
        daily_bars: 6,
        strategy_replay: true,
        financial_metrics: metrics,
        navigation,
        progressive_news: progressiveNews,
        etf_applicability: true,
        etf_nav_portfolio: true,
        pcf_cutoff_filter: true,
        public_tdcc_history: true,
        cathay_quarterly: true,
        official_book_value: true,
        source_multiple_bands: true,
        chip_api: true,
        chip_availability: chipAvailability.map((r) => ({
          tab: r.tab,
          rows: r.rows,
        })),
        market: true,
        order_book: true,
        responsive,
      }),
    );
  } finally {
    if (ws) {
      try {
        await send("Browser.close");
      } catch {}
      ws.close();
    }
    child.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
