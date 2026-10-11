// Standalone headless Chrome fallback when the in-app Browser is unavailable.
// No npm packages; Node 22 supplies fetch and WebSocket.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const base = process.env.BASE_URL || "http://127.0.0.1:5173";
const root = path.resolve(__dirname, ".."),
  scratch = path.join(root, ".tmp");
fs.mkdirSync(scratch, { recursive: true });
const chrome =
  process.env.CHROME_PATH ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";
const child = spawn(
  chrome,
  [
    "--headless=new",
    "--remote-debugging-port=9223",
    `--user-data-dir=${path.join(scratch, "stock-browser-profile")}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1440,1200",
    "about:blank",
  ],
  { stdio: "ignore", windowsHide: true },
);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let ws,
  session,
  id = 0;
const pending = new Map(),
  errors = [];
async function send(method, params = {}) {
  const key = ++id;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(key);
      reject(Error("CDP timeout: " + method));
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
  expression = `(() => { with (globalThis.stockCoach || {}) { return eval(${JSON.stringify(expression)}); } })()`;
  const response = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
}
async function until(expression) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await pause(300);
  }
  const diagnostics = await evaluate('JSON.stringify({financialStatus:document.getElementById("financialStatus")?.textContent,historyStatus:document.getElementById("historyStatus")?.textContent})');
  throw Error("UI wait failed: " + expression + " " + diagnostics + " " + JSON.stringify(errors));
}
(async () => {
  try {
    let metadata;
    for (let i = 0; i < 40; i++) {
      try {
        metadata = await (
          await fetch("http://127.0.0.1:9223/json/version")
        ).json();
        break;
      } catch {
        await pause(250);
      }
    }
    assert.ok(metadata, "Headless Chrome did not start");
    ws = new WebSocket(metadata.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.exceptionThrown")
        errors.push(message.params.exceptionDetails);
      const request = pending.get(message.id);
      if (request) {
        clearTimeout(request.timer);
        pending.delete(message.id);
        message.error
          ? request.reject(Error(message.error.message))
          : request.resolve(message.result);
      }
    };
    const context = await send("Target.createBrowserContext");
    const target = await send("Target.createTarget", { url: "about:blank", browserContextId: context.browserContextId });
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
      height: 1200,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send("Page.navigate", { url: base });
    await until(
      'document.readyState === "complete" && document.getElementById("historyRows").children.length > 0',
    );
    await evaluate(
      'document.getElementById("startDate").value="2026-04-01";document.getElementById("endDate").value="2026-10-08";document.getElementById("endDate").dispatchEvent(new Event("change"))',
    );
    await until(
      'document.getElementById("quoteStatus").textContent.includes("2026-04-01 至 2026-10-08") && document.getElementById("chartDescription").textContent.includes("根 日 K")',
    );
    await evaluate('document.querySelectorAll("[data-days]")[0].click()');
    await until('document.getElementById("chartDescription").textContent.includes("顯示 1／1 根")');
    assert.equal(await evaluate('document.getElementById("startDate").value'),"2026-10-08");
    assert.equal(await evaluate('document.querySelectorAll("[data-days]")[0].getAttribute("aria-pressed")'),"true");
    await evaluate('document.querySelectorAll("[data-days]")[1].click()');
    await until('document.getElementById("chartDescription").textContent.includes("顯示 7／7 根")');
    assert.equal(await evaluate('document.getElementById("startDate").value'),"2026-09-30");
    assert.equal(await evaluate('document.getElementById("chartPosition")===null'),true,"Date slider should be removed");
    await evaluate('document.getElementById("startDate").value="2026-04-01";document.getElementById("applyDates").click()');
    await until('document.getElementById("chartDescription").textContent.includes("顯示 130／130 根")');
    assert.equal(await evaluate('document.querySelectorAll("[data-days][aria-pressed=true]").length'),0);
    assert.match(await evaluate('document.getElementById("rangeSelection").textContent'),/自訂區間/);
    const expectedPanels = {overview:2,technical:1,basic:1,financial:1,chips:1,calculator:1,peers:1,backtest:1,news:1,indices:1};
    for (const [view,count] of Object.entries(expectedPanels)) {
      await evaluate(view === "indices" ? 'document.querySelector("[data-app-page=market]").click()' : view === "calculator" ? 'document.querySelector("[data-app-page=calculator]").click()' : `document.querySelector('[data-section="${view}"]').click()`);
      assert.equal(await evaluate('document.querySelectorAll("[data-view-panel]:not([hidden])").length'),count,`Wrong visible panels for ${view}`);
      assert.equal(await evaluate('document.getElementById("queryControls").hidden'),["calculator","peers","indices","news"].includes(view));
    }
    await evaluate('selectSection("overview",false)');
    assert.equal(await evaluate('document.getElementById("valuationMetrics")'),null,"Basic valuation section must be removed");
    await evaluate('selectSection("technical",false)');
    assert.equal(await evaluate('document.getElementById("historyPanel").open'),false,"Historical quotes should start collapsed");
    assert.equal(await evaluate('document.getElementById("historyPanel").closest("#technicalPanel")!==null'),true);
    await evaluate('document.getElementById("historyPanel").open=true');
    assert.ok(await evaluate('document.getElementById("historyRows").getBoundingClientRect().height>0'));
    await evaluate('document.getElementById("historyPanel").open=false');
    await evaluate('selectSection("overview",false)');
    await evaluate('selectBar(state.rows[0])');
    assert.equal(await evaluate('state.selected.trade_date'),"2026-04-01");
    await evaluate('state.selected=null;renderAnalysis()');
    const full = await evaluate(
      'document.getElementById("chartDescription").textContent',
    );
    assert.equal(await evaluate('!!document.getElementById("strategyPanel") || !!document.getElementById("riskForm")'), false);
    await evaluate('document.getElementById("showBollinger").checked=true;document.getElementById("showBollinger").dispatchEvent(new Event("change"))');
    assert.equal(await evaluate('document.querySelectorAll("[data-bollinger]").length'), 2);
    await evaluate('selectSection("backtest",false);document.getElementById("runBacktest").click()');
    await until('document.getElementById("backtestMetrics").children.length===5');
    assert.match(await evaluate('document.getElementById("backtestStatus").textContent'), /2026-04-01 至 2026-10-08/);
    const backtestResult = await evaluate('document.getElementById("backtestStatus").textContent');
    await evaluate('selectSection("overview",false)');
    assert.equal(
      await evaluate(
        '!!document.getElementById("customMA") || !!document.querySelector("#resolution option[value=snapshot]")',
      ),
      false,
    );
    assert.match(
      await evaluate(
        'document.querySelector(".metric .metric-badge").textContent',
      ),
      /均線/,
    );
    assert.notEqual(
      await evaluate(
        'getComputedStyle(document.querySelector(".metric")).borderLeftColor',
      ),
      await evaluate(
        'getComputedStyle(document.querySelector(".metric")).borderRightColor',
      ),
    );
    await evaluate('document.getElementById("zoomIn").click()');
    const zoom = await evaluate(
      'document.getElementById("chartDescription").textContent',
    );
    assert.notEqual(full, zoom, "Zoom did not alter visible candle range");
    await evaluate('document.getElementById("panLeft").click()');
    assert.notEqual(
      await evaluate('document.getElementById("chartDescription").textContent'),
      zoom,
      "Pan did not move dates",
    );
    await evaluate(
      'document.getElementById("maLegend").querySelector("button").click()',
    );
    assert.equal(
      await evaluate(
        'document.getElementById("maLegend").querySelector("button").getAttribute("aria-pressed")',
      ),
      "false",
    );
    await evaluate(
      'document.getElementById("historyRows").querySelector("tr").click()',
    );
    assert.match(
      await evaluate('document.getElementById("selectedBar").textContent'),
      /已完成/,
    );
    await evaluate(
      'document.getElementById("autoRefresh").checked=true;document.getElementById("autoRefresh").dispatchEvent(new Event("change"))',
    );
    const status = await (
      await fetch(base + "/api/market/status")
    ).json();
    if (!status.monitor_allowed)
      await until(
        'document.getElementById("monitorStatus").textContent.includes("暫停更新")',
      );
    await until(
      'document.getElementById("historyRows").children.length>0 && document.getElementById("chartDescription").textContent.includes("根 日 K")',
    );
    await evaluate(
      'selectSection("overview",false);document.getElementById("chart").scrollIntoView({block:"center"})',
    );
    const screenshot = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    fs.writeFileSync(
      path.join(scratch, "stock-dashboard.png"),
      Buffer.from(screenshot.data, "base64"),
    );
    await evaluate(
      'selectSection("technical",false);document.getElementById("metrics").scrollIntoView({block:"start"})',
    );
    const indicators = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    fs.writeFileSync(
      path.join(scratch, "stock-indicators.png"),
      Buffer.from(indicators.data, "base64"),
    );
    await until('document.getElementById("financialMetrics").children.length>0 || document.getElementById("financialStatus").textContent.includes("載入失敗")');
    const financialResult = await evaluate('document.getElementById("financialCoverage").textContent');
    await evaluate('selectSection("financial",false);document.getElementById("financialPanel").scrollIntoView({block:"start"})');
    assert.equal(await evaluate('document.getElementById("chartPanel").hidden && !document.getElementById("financialPanel").hidden'),true);
    const financeScreenshot = await send("Page.captureScreenshot", {format:"png",captureBeyondViewport:false});
    fs.writeFileSync(path.join(scratch,"stock-financials.png"),Buffer.from(financeScreenshot.data,"base64"));
    await evaluate('document.getElementById("financialMode").value="historical";document.getElementById("financialMode").dispatchEvent(new Event("change"))');
    await until('document.getElementById("financialStatus").textContent.includes("歷史當時可得")');
    assert.equal(await evaluate('document.getElementById("financialMetrics").children.length'),0,"Newly downloaded financials leaked into historical candles");
    await evaluate(
      'selectSection("overview",false);document.getElementById("chart").scrollIntoView({block:"center"})',
    );
    // Exercise a true pointer drag and wheel zoom on the rendered SVG.
    await evaluate('document.getElementById("zoomIn").click()');
    const rect = await evaluate(
      '(()=>{const r=document.getElementById("chart").getBoundingClientRect();return {x:r.left+r.width*.5,y:r.top+r.height*.4}})()',
    );
    const beforeDrag = await evaluate(
      'document.getElementById("chartDescription").textContent',
    );
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: rect.x,
      y: rect.y,
      button: "left",
      clickCount: 1,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: rect.x + 130,
      y: rect.y,
      button: "left",
      buttons: 1,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: rect.x + 130,
      y: rect.y,
      button: "left",
      clickCount: 1,
    });
    assert.notEqual(
      await evaluate('document.getElementById("chartDescription").textContent'),
      beforeDrag,
      "Pointer dragging failed",
    );
    const beforeWheel = await evaluate(
      'document.getElementById("chartDescription").textContent',
    );
    await send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: rect.x,
      y: rect.y,
      deltaX: 0,
      deltaY: -120,
    });
    await until(
      `document.getElementById("chartDescription").textContent !== ${JSON.stringify(beforeWheel)}`,
    );
    // Verify the vendored framework and real responsive layouts.
    assert.equal(await evaluate('typeof bootstrap.Collapse'), "function");
    await evaluate('document.getElementById("financialMode").value="latest";document.getElementById("financialMode").dispatchEvent(new Event("change"));selectSection("overview",false);window.scrollTo(0,0)');
    await until('document.getElementById("quickMetrics").children.length===6');
    assert.equal(await evaluate('document.getElementById("quickFinancialPanel")===null'),true,"Unwanted financial snapshot remains");
    await evaluate('document.querySelector("[data-bs-toggle=collapse]").click()');
    await until('document.getElementById("dataStatus").classList.contains("show")');
    await evaluate('document.querySelector("[data-bs-toggle=collapse]").click()');
    await until('!document.getElementById("dataStatus").classList.contains("show") && !document.getElementById("dataStatus").classList.contains("collapsing")');
    const responsive = [];
    for (const [name, width, height] of [["desktop",1440,900],["tablet",1024,768],["mobile",390,844],["small-mobile",320,740]]) {
      await send("Emulation.setDeviceMetricsOverride", {width,height,deviceScaleFactor:1,mobile:width<768});
      await evaluate('window.scrollTo(0,0);plot()');
      await pause(200);
      const dimensions = await evaluate('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,chartWidth:document.getElementById("chart").getBoundingClientRect().width,chartHeight:document.getElementById("chart").getBoundingClientRect().height})');
      assert.ok(dimensions.scrollWidth <= dimensions.width+1, `${name} overflow: ${JSON.stringify(dimensions)}`);
      assert.ok(dimensions.chartWidth > 230 && dimensions.chartHeight >= 280, `${name} chart collapsed`);
      if (width >= 1024) {
        assert.ok(dimensions.chartHeight>=360, `${name} price chart compressed`);
        assert.equal(await evaluate('Math.abs(document.querySelector(".chart-heading h2").getBoundingClientRect().top-document.querySelector(".chart-heading").getBoundingClientRect().top)<2'),true,`${name} chart title is not aligned to the top`);
        const before=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
        fs.writeFileSync(path.join(scratch,`layout-${name}.png`),Buffer.from(before.data,"base64"));
        const layout=await evaluate('({chartTop:document.getElementById("chart").getBoundingClientRect().top,chartBottom:document.getElementById("chart").getBoundingClientRect().bottom,panelTop:document.getElementById("chartPanel").getBoundingClientRect().top,height:innerHeight})');
        assert.ok(layout.chartBottom<=layout.height, `${name} trend chart below fold: ${JSON.stringify(layout)}`);
        assert.equal(await evaluate('document.getElementById("quickMetrics").getBoundingClientRect().bottom <= document.getElementById("chart").getBoundingClientRect().top'),true, `${name} indicators below chart`);
        assert.ok(await evaluate('parseFloat(getComputedStyle(document.querySelector("#bookRows td")).fontSize)>=17'), `${name} order book text too small`);
      }
      const screenshot = await send("Page.captureScreenshot", {format:"png",captureBeyondViewport:false});
      fs.writeFileSync(path.join(scratch,`workbench-${name}.png`),Buffer.from(screenshot.data,"base64"));
      await evaluate('document.getElementById("chart").scrollIntoView({block:"center",behavior:"instant"})');
      const clippedLabels = await evaluate('Array.from(document.querySelectorAll("#chart text")).filter(el=>{const r=el.getBBox(),v=document.getElementById("chart").viewBox.baseVal;return r.x < -1 || r.y < -1 || r.x+r.width>v.width+1 || r.y+r.height>v.height+1}).map(el=>el.textContent)');
      assert.deepEqual(clippedLabels,[],`${name} chart labels clipped`);
      const trend = await send("Page.captureScreenshot", {format:"png",captureBeyondViewport:false});
      fs.writeFileSync(path.join(scratch,`trend-${name}.png`),Buffer.from(trend.data,"base64"));
      assert.equal(await evaluate('document.getElementById("analysisReport")===null && document.getElementById("advicePanel")===null'),true,"Health report should be removed");
      responsive.push({name,...dimensions});
    }
    // New research views: real histories, date filtering, bar chart and missing-source states.
    await evaluate('selectSection("financial",false)');
    await until('state.financialData?.history?.eps?.length>2');
    await evaluate('selectSection("peers",false)');
    await until('peerData && document.getElementById("peerRows").children.length>0');
    assert.ok(await evaluate('peerData.rows.length>6'),"Full industry candidates were truncated");
    assert.ok(await evaluate('document.getElementById("peerRows").children.length<=10'),"Peer pagination absent");
    const firstPeerCodes=await evaluate('Array.from(document.querySelectorAll("#peerRows td:first-child")).map(el=>el.textContent).join("|")');
    await evaluate('document.getElementById("peerNext").click()');
    assert.notEqual(await evaluate('Array.from(document.querySelectorAll("#peerRows td:first-child")).map(el=>el.textContent).join("|")'),firstPeerCodes,"Peer page did not change");
    await evaluate('document.getElementById("peerFilter").value="2303";document.getElementById("peerFilter").dispatchEvent(new Event("input"))');
    assert.equal(await evaluate('document.getElementById("peerRows").children.length'),1);
    await evaluate('document.getElementById("peerFilter").value="";document.getElementById("peerFilter").dispatchEvent(new Event("input"))');
    await evaluate('selectSection("financial",false)');
    for(const category of ["statements","safety","growth","valuation","profitability"]){
      await evaluate(`document.querySelector('[data-financial-category="${category}"]').click()`);
      assert.equal(await evaluate(`document.querySelector('[data-financial-category="${category}"]').getAttribute("aria-pressed")`),"true");
      if(category==="statements") assert.equal(await evaluate('document.querySelectorAll("#financialMetrics .research-card").length'),3,"Monthly revenue subsection absent");
      else assert.ok(await evaluate('document.querySelectorAll("#financialMetrics .research-card").length>0'),`${category} cards absent`);
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${category} category overflow`);
    }
    const researchResponsive=[];
    let subsectionCount=0;
    for(const category of ["statements","profitability","safety","growth","valuation"]){
      await evaluate(`document.querySelector('[data-financial-category="${category}"]').click()`);
      const pages=await evaluate('Array.from(document.querySelectorAll("#financialSubpages button")).map(b=>({id:b.dataset.financialPage,label:b.querySelector("span").textContent,status:b.querySelector("small").dataset.status}))');
      subsectionCount+=pages.length;
      for(const page of pages){
        await evaluate(`document.querySelector('[data-financial-page="${page.id}"]').click()`);
        assert.equal(await evaluate('document.querySelector(".financial-detail-heading h3").textContent'),page.label);
        if(page.status==="dependency_missing")assert.ok(await evaluate('document.querySelector(".financial-dependency").textContent.length>30'),`${page.id} missing-dependency reason absent`);
        assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${page.id} detail overflow`);
      }
    }
    assert.equal(subsectionCount,38,"Finance submenu parity lost");
    await evaluate('document.querySelector("[data-financial-category=profitability]").click();document.querySelector("[data-financial-page=profit-margin]").click()');
    const financialHistoryCount=await evaluate('document.querySelectorAll(".financial-inline-plot circle").length');
    assert.equal(await evaluate('document.querySelectorAll("[data-financial-line]").length'),4,"Profit margins must compare four lines");
    assert.equal(await evaluate('document.querySelectorAll(".financial-comparison-table tbody tr").length'),4,"Metric table rows must match comparison lines");
    assert.equal(await evaluate('document.querySelectorAll(".financial-comparison-table thead th").length'),5,"Default table must have four periods");
    await evaluate('document.querySelector("[data-financial-series=gross_margin]").click()');
    assert.equal(await evaluate('document.querySelectorAll("[data-financial-line]").length'),3,"Series checkbox ignored");
    assert.equal(await evaluate('document.querySelectorAll(".financial-comparison-table tbody tr").length'),3,"Unchecked series remains in numeric table");
    await evaluate('document.querySelector("[data-financial-series=gross_margin]").click()');
    assert.ok(financialHistoryCount>4,"Inline financial history absent");
    await evaluate('const fields=document.querySelectorAll(".financial-history-tools input");fields[0].value="2026-01-01";fields[1].value="2026-06-30";fields[1].dispatchEvent(new Event("change"))');
    assert.ok(await evaluate('document.querySelectorAll(".financial-inline-plot circle").length')<financialHistoryCount,"Inline custom range ignored");
    await evaluate('renderFinancialResearch(state.financialData)');
    assert.equal(await evaluate('document.querySelectorAll(".financial-history-tools input")[0].value'),"2026-01-01","Range lost during data refresh");
    await evaluate('Array.from(document.querySelectorAll(".financial-history-tools button")).find(b=>b.textContent.includes("全部")).click()');
    assert.equal(await evaluate('financialLinePath([{period:"a",value:1},{period:"c",value:3}],["a","b","c"],p=>p.value,p=>p.value)'),"M1,1  M3,3","Missing period must break chart line");
    await evaluate('document.querySelector("[data-financial-category=statements]").click();document.querySelector("[data-financial-page=assets]").click()');
    assert.equal(await evaluate('document.querySelectorAll(".financial-comparison-table tbody tr").length'),8,"Asset detail rows incomplete");
    const cashInThousands=await evaluate('document.querySelector("[data-financial-row=cash_balance] td:last-child").textContent.replaceAll(",","")');
    await evaluate('const unit=document.querySelector("[aria-label=財務金額單位]");unit.value="1";unit.dispatchEvent(new Event("change"))');
    const cashInDollars=await evaluate('document.querySelector("[data-financial-row=cash_balance] td:last-child").textContent.replaceAll(",","")');
    assert.equal(Number(cashInDollars),Number(cashInThousands)*1000,"Display amount unit ignored");
    await evaluate('document.querySelector("[data-financial-category=profitability]").click();document.querySelector("[data-financial-page=profit-margin]").click()');
    for (const [name,width,height] of [["desktop",1440,900],["mobile",390,844],["small-mobile",320,740]]) {
      await send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:width<768});
      await evaluate('selectSection("calculator",false);document.getElementById("calcMode").value="roundtrip";document.getElementById("calcAsset").value="stock";document.getElementById("calcQuantity").value="1";document.getElementById("calcUnit").value="lots";document.getElementById("calcBuyPrice").value="100";document.getElementById("calcSellPrice").value="101";calcSettings(true);document.getElementById("calculatorForm").requestSubmit();window.scrollTo(0,0)');
      await until('document.getElementById("calcResults").textContent.includes("412") && document.getElementById("calcLegs").children.length===2');
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${name} calculator overflow`);
      const calculatorShot=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
      fs.writeFileSync(path.join(scratch,`calculator-${name}.png`),Buffer.from(calculatorShot.data,"base64"));
      await evaluate('document.getElementById("calcScenarioMode").value="percent";document.getElementById("calcMode").value="day_short";document.getElementById("calcBuyPrice").value="99";document.getElementById("calcSellPrice").value="100";calcChosenChange=-1;calcSettings(true);document.getElementById("calculatorForm").requestSubmit()');
      await until('document.getElementById("calcResults").textContent.includes("567")');
      assert.equal(await evaluate('document.getElementById("calcLegs").firstChild.firstChild.textContent.includes("賣出")'),true,"Short opening leg is not sell");
      await evaluate('document.getElementById("calcUnit").value="shares";document.getElementById("calcQuantity").value="37";document.getElementById("calculatorForm").requestSubmit()');
      await until('document.getElementById("calcStatus").textContent.includes("零股不適用")');
      await evaluate('document.getElementById("calcUnit").value="lots";document.getElementById("calcQuantity").value="1";document.getElementById("calcMode").value="day_long";document.getElementById("calcBuyPrice").value="100";calcChosenChange=1;calcSettings();document.getElementById("calculatorForm").requestSubmit()');
      await until('document.getElementById("calcResults").textContent.includes("564") && document.getElementById("calcScenarioRows").children.length===11');
      assert.equal(await evaluate('document.getElementById("calcSellPrice").value'),"101.00");
      await evaluate('document.getElementById("calcMode").value="day_short";document.getElementById("calcSellPrice").value="100";calcChosenChange=-1;calcSettings();document.getElementById("calculatorForm").requestSubmit()');
      await until('document.getElementById("calcResults").textContent.includes("567")');
      assert.equal(await evaluate('document.getElementById("calcBuyPrice").value'),"99.00");
      await evaluate('document.getElementById("calcUpStep").value="0.5";document.getElementById("calcDownStep").value="0.25";document.getElementById("calcSteps").value="3";calcChosenChange=0;calcSettings();document.getElementById("calculatorForm").requestSubmit()');
      await until('document.getElementById("calcScenarioRows").children.length===7');
      assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("#calcScenarioRows button")).map(el=>el.textContent)'),["-0.75%","-0.5%","-0.25%","原價","+0.5%","+1%","+1.5%"]);
      await evaluate('document.querySelectorAll("#calcScenarioRows button")[2].click()');
      await until('document.getElementById("calcStatus").textContent.includes("-0.25%") && document.getElementById("calcBuyPrice").value==="99.80"');
      assert.equal(await evaluate('document.querySelectorAll("#calcScenarioRows tr")[2].children[2].querySelector("small").textContent'),"-0.2%");
      assert.equal(await evaluate('document.getElementById("calcPriceMode")'),null);
      await evaluate('document.getElementById("calcUpStep").value="1";document.getElementById("calcDownStep").value="1";document.getElementById("calcSteps").value="5";calcChosenChange=null;calcSettings()');

      await evaluate('document.getElementById("calcScenarioMode").value="ticks";document.getElementById("calcMode").value="day_long";document.getElementById("calcBuyPrice").value="49.95";calcChosenTicks=0;calcChosenChange=null;calcSettings();document.getElementById("calculatorForm").requestSubmit()');
      await until('document.getElementById("calcScenarioRows").children.length===11 && document.getElementById("calcTickNote").textContent.includes("49.95")');
      assert.equal(await evaluate('document.getElementById("calcUpStep").disabled'),true,"Tick mode still requires percentage fields");
      assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("#calcScenarioRows tr")).slice(5,8).map(row=>row.children[1].textContent)'),["49.95","50","50.1"],"Tick prices did not cross stock band");
      await evaluate('document.querySelectorAll("#calcScenarioRows button")[7].click()');
      await until('document.getElementById("calcSellPrice").value==="50.10" && document.getElementById("calcStatus").textContent.includes("2 檔")');
      await evaluate('document.getElementById("calcBuyPrice").value="1000";document.getElementById("calcBuyDown").click()');
      assert.equal(await evaluate('document.getElementById("calcBuyPrice").value'),"999.00","1000 down tick must be 1 dollar");
      await evaluate('document.getElementById("calcBuyUp").click();document.getElementById("calcBuyUp").click()');
      assert.equal(await evaluate('document.getElementById("calcBuyPrice").value'),"1005.00","1000 up tick must be 5 dollars");
      await evaluate('document.getElementById("calcAsset").value="etf";document.getElementById("calcBuyPrice").value="50";document.getElementById("calcBuyDown").click()');
      assert.equal(await evaluate('document.getElementById("calcBuyPrice").value'),"49.99","ETF lower band differs from stock");
      await evaluate('document.getElementById("calcAsset").value="stock";document.getElementById("calcBuyPrice").value="38";calcChosenTicks=0;calcSettings();document.getElementById("calculatorForm").requestSubmit()');
      await until('document.getElementById("calcTickNote").textContent.includes("上跳一檔 0.05") && document.getElementById("calcSellPrice").value==="38.00"');
      await evaluate('document.querySelectorAll("#calcScenarioRows button")[6].click()');
      await until('document.getElementById("calcSellPrice").value==="38.05" && document.getElementById("calcResults").textContent.includes("-115")');
      assert.equal(await evaluate('document.querySelectorAll("#calcScenarioRows tr")[6].children[3].textContent'),"50 元","One lot tick must show 50 dollar gross movement");
      assert.equal(await evaluate('document.getElementById("calcBuyLabel").hidden || document.getElementById("calcSellLabel").hidden'),false,"Day trade must show both prices");
      assert.equal(await evaluate('document.getElementById("calcBuyPrice").disabled || document.getElementById("calcSellPrice").disabled'),false,"Day trade prices must both be editable");
      await evaluate('document.getElementById("calcSellPrice").value="38.2";document.getElementById("calcSellPrice").dispatchEvent(new Event("input",{bubbles:true}));document.getElementById("calculatorForm").requestSubmit()');
      await until('document.getElementById("calcStatus").textContent.includes("依輸入買賣價") && document.getElementById("calcResults").textContent.includes("35")');
      assert.equal(await evaluate('document.getElementById("calcSellPrice").value'),"38.2","Manual sell price must not be overwritten");
      await evaluate('document.getElementById("calcCloseTicks").value="3";document.getElementById("calcCloseTicks").dispatchEvent(new Event("input",{bubbles:true}));document.getElementById("calculatorForm").requestSubmit()');
      await until('document.getElementById("calcSellPrice").value==="38.15" && document.getElementById("calcStatus").textContent.includes("3 檔")');
      await evaluate('document.getElementById("calcMode").value="day_short";document.getElementById("calcSellPrice").value="1000";document.getElementById("calcCloseTicks").value="-3";document.getElementById("calcCloseTicks").dispatchEvent(new Event("input",{bubbles:true}));calcSettings();document.getElementById("calculatorForm").requestSubmit()');
      await until('document.getElementById("calcBuyPrice").value==="997.00" && document.getElementById("calcStatus").textContent.includes("-3 檔")');
      await evaluate('document.getElementById("calcBuyPrice").value="995";document.getElementById("calcBuyPrice").dispatchEvent(new Event("input",{bubbles:true}));document.getElementById("calculatorForm").requestSubmit()');
      await until('document.getElementById("calcStatus").textContent.includes("依輸入買賣價") && document.getElementById("calcBuyPrice").value==="995"');
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${name} automatic tick calculator overflow`);

      await evaluate('selectSection("peers",false);window.scrollTo(0,0)');
      await until('peerData!==null && document.getElementById("peerRows").children.length>1');
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${name} peers overflow`);
      assert.equal(await evaluate('peerData.rows.every(row=>Object.values(row.metrics).every(metric=>["available","missing","stale"].includes(metric.status)))'),true,"Peer missing-data state absent");
      const peerShot=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
      fs.writeFileSync(path.join(scratch,`peers-${name}.png`),Buffer.from(peerShot.data,"base64"));
      for (const section of ["financial","basic","chips"]) {
        await evaluate(`selectSection(${JSON.stringify(section)},false);window.scrollTo(0,0)`);
        if(section!=="financial") await until('state.equityData!==null');
        await pause(250);
        assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${section} ${name} overflows`);
        if(section==="financial") {
          if(width<768){
            assert.equal(await evaluate('getComputedStyle(document.getElementById("financialSubpages")).display'),"none");
            await evaluate('document.querySelector("[data-financial-category=profitability]").click();document.getElementById("financialSubpageSelect").value="turnover-days";document.getElementById("financialSubpageSelect").dispatchEvent(new Event("change"))');
            assert.equal(await evaluate('document.querySelector(".financial-detail-heading h3").textContent'),"營運週轉天數","Mobile dropdown did not change subsection");
            await evaluate('document.getElementById("financialSubpageSelect").value="profit-margin";document.getElementById("financialSubpageSelect").dispatchEvent(new Event("change"))');
          }
          assert.equal(await evaluate('document.querySelector(".financial-legend .fund-good").textContent.includes("紅")'),true);
          assert.equal(await evaluate('getComputedStyle(document.querySelector("#financialMetrics .fund-good")).borderTopColor'),"rgb(255, 114, 139)");
        }
        if(section==="chips") {
          assert.equal(await evaluate('document.getElementById("brokerMetrics").textContent.includes("FINMIND_TOKEN")'),true);
          assert.equal(await evaluate('document.getElementById("fundRows").textContent.includes("來源")'),true);
          assert.ok(await evaluate('document.querySelectorAll("#distributionRows tr").length>1'),"Public TDCC distribution missing");
        }
        const screenshot=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
        fs.writeFileSync(path.join(scratch,`${section}-${name}.png`),Buffer.from(screenshot.data,"base64"));
      }
      await evaluate('document.getElementById("volumeUnit").value="shares";document.getElementById("volumeUnit").dispatchEvent(new Event("change"))');
      const shareText=await evaluate('document.getElementById("institutionRows").firstChild?.children[1]?.textContent');
      await evaluate('document.getElementById("volumeUnit").value="lots";document.getElementById("volumeUnit").dispatchEvent(new Event("change"))');
      const lotText=await evaluate('document.getElementById("institutionRows").firstChild?.children[1]?.textContent');
      if(shareText && shareText!=="—") assert.ok(Math.abs(Number(shareText.replaceAll(",",""))/1000-Number(lotText.replaceAll(",","")))<.00001,"Chip shares/lots conversion incorrect");
      assert.equal(await evaluate('document.getElementById("chipUnitNote").textContent.includes("張")'),true,"Chip unit label stale");
      await evaluate('selectSection("financial",false);document.querySelector("[data-financial-category=statements]").click();document.querySelector("[data-financial-page=eps]").click();Array.from(document.querySelectorAll("#financialMetrics [role=button]")).find(el=>el.textContent.includes("每股盈餘")).click()');
      await until('document.getElementById("insightModal").classList.contains("show") && document.querySelectorAll("#insightChart circle").length>2');
      const total=await evaluate('document.querySelectorAll("#insightRows tr").length');
      await evaluate('Array.from(document.querySelectorAll("[data-insight-years]")).find(el=>el.dataset.insightYears==="1").click();document.getElementById("insightChartType").value="bar";document.getElementById("insightChartType").dispatchEvent(new Event("change"))');
      const filtered=await evaluate('document.querySelectorAll("#insightRows tr").length');
      assert.ok(filtered>0 && filtered<total,"Trend preset did not filter actual history");
      assert.ok(await evaluate('document.querySelectorAll("#insightChart rect").length>0'),"Bar chart missing");
      await evaluate('document.getElementById("insightStart").value="2026-01-01";document.getElementById("insightEnd").value="2026-06-30";document.getElementById("insightForm").requestSubmit()');
      assert.equal(await evaluate('Array.from(document.querySelectorAll("#insightRows tr")).every(el=>el.firstChild.textContent>="2026-01-01" && el.firstChild.textContent<="2026-06-30")'),true,"Custom dates ignored");
      assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("#insightChart text")).filter(el=>{const r=el.getBBox(),v=document.getElementById("insightChart").viewBox.baseVal;return r.x < -1 || r.x+r.width>v.width+1}).map(el=>el.textContent)'),[],`${name} research chart labels clipped`);
      const screenshot=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
      fs.writeFileSync(path.join(scratch,`financial-trend-${name}.png`),Buffer.from(screenshot.data,"base64"));
      await evaluate('bootstrap.Modal.getInstance(document.getElementById("insightModal")).hide()');
      await until('!document.body.classList.contains("modal-open")');
      researchResponsive.push({name,total,filtered});
    }
    await evaluate('selectSection("basic",false);document.getElementById("basicViewMode").value="historical";document.getElementById("basicViewMode").dispatchEvent(new Event("change"))');
    await until('state.equityData!==null');
    assert.equal(await evaluate('state.equityData.profile===null && state.equityData.targets.median===null'),true,"Historical view leaks newly received research");
    await evaluate('document.getElementById("basicViewMode").value="latest";document.getElementById("basicViewMode").dispatchEvent(new Event("change"));selectSection("overview",false)');
    await evaluate(
      'document.getElementById("autoRefresh").checked=false;document.getElementById("startDate").value="2026-10-01";document.getElementById("endDate").value="2026-10-08";document.getElementById("resolution").value="60m";document.getElementById("resolution").dispatchEvent(new Event("change"))',
    );
    await until(
      'document.getElementById("historyStatus").textContent.includes("Sponsor") || document.getElementById("historyStatus").textContent.includes("根 1 小時 K")',
    );
    const minuteResult = await evaluate(
      'document.getElementById("historyStatus").textContent',
    );
    assert.deepEqual(errors, [], "Browser raised JavaScript errors");
    const report = {
        status: "passed",
        responsive,
        researchResponsive,
        historicalRange: full,
        zoomedRange: zoom,
        minuteResult,
        backtestResult,
        financialResult,
        monitor: await evaluate(
          'document.getElementById("monitorStatus").textContent',
        ),
        screenshot: ".tmp/stock-dashboard.png",
      };
    await send('Page.navigate',{url:base+'/docs/'});
    await until('document.querySelector(".swagger-ui")!==null && document.body.textContent.includes("/api/calculator")');
    assert.deepEqual(errors, [], 'API documentation raised JavaScript errors');
    report.apiDocs='passed';
    console.log(JSON.stringify(report));
  } finally {
    if (ws) {
      try {
        await send("Browser.close");
      } catch {}
      ws.close();
    }
    child.kill();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
