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
    assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("[data-section]")).slice(0,3).map(b=>b.dataset.section)'),["overview","technical","basic"]);
    assert.equal(await evaluate('document.getElementById("dividendMetrics")'),null);
    assert.equal(await evaluate('document.getElementById("basicCoverage")'),null);
    await evaluate('selectSection("technical",false)');
    assert.equal(await evaluate('document.getElementById("historyPanel").open'),false);
    await evaluate('document.querySelector("#historyPanel summary").click()');
    assert.ok(await evaluate('document.getElementById("historyRows").getBoundingClientRect().height>0'));
    await evaluate('selectSection("indices",false)');
    await until('document.querySelectorAll(".market-board-card").length===3 && document.querySelectorAll("#boardChart path").length>0');
    assert.equal(await evaluate('document.getElementById("boardBookRows").children.length'),0);
    assert.equal(await evaluate('document.getElementById("queryControls").hidden'),true);
    await evaluate('document.querySelector("[data-product=day]").click()');
    await until('document.getElementById("boardBookRows").children.length===5 && document.getElementById("boardChartTitle").textContent.includes("日盤")');
    const day = await evaluate('document.querySelector("[data-product=day] strong").textContent');
    const selectedContract=await evaluate('document.getElementById("boardContract").value');
    await evaluate('document.querySelector("[data-product=night]").click()');
    await until('document.getElementById("boardBookRows").children.length===5 && document.getElementById("boardChartTitle").textContent.includes("夜盤")');
    assert.equal(await evaluate('document.getElementById("boardContract").value.replace(/-M$/,"-F")'),selectedContract);
    const night=await evaluate('document.querySelector("[data-product=night] strong").textContent');
    const fiveMinute=await evaluate('document.getElementById("boardChartCaption").textContent');
    await evaluate('document.getElementById("boardResolution").value="60";document.getElementById("boardResolution").dispatchEvent(new Event("change"))');
    const hourly=await evaluate('document.getElementById("boardChartCaption").textContent');
    assert.ok(Number(hourly.match(/顯示 (\d+)/)[1])<Number(fiveMinute.match(/顯示 (\d+)/)[1]));
    await evaluate('document.getElementById("boardResolution").value="5";document.getElementById("boardResolution").dispatchEvent(new Event("change"))');
    await evaluate('const svg=document.getElementById("boardChart"),r=svg.getBoundingClientRect();svg.dispatchEvent(new WheelEvent("wheel",{deltaY:-120,clientX:r.left+r.width/2,clientY:r.top+150,cancelable:true}))');
    assert.ok(Number((await evaluate('document.getElementById("boardChartCaption").textContent')).match(/顯示 (\d+)/)[1])<Number(fiveMinute.match(/顯示 (\d+)/)[1]));
    const zoomed=await evaluate('document.getElementById("boardChartCaption").textContent');
    const point=await evaluate('const r=document.getElementById("boardChart").getBoundingClientRect();({x:r.left+r.width/2,y:r.top+r.height/2})');
    await send("Input.dispatchMouseEvent",{type:"mouseMoved",...point});
    await send("Input.dispatchMouseEvent",{type:"mousePressed",...point,button:"left",clickCount:1});
    await send("Input.dispatchMouseEvent",{type:"mouseMoved",x:point.x+80,y:point.y,buttons:1});
    await send("Input.dispatchMouseEvent",{type:"mouseReleased",x:point.x+80,y:point.y,button:"left",clickCount:1});
    assert.notEqual(await evaluate('document.getElementById("boardChartCaption").textContent'),zoomed,"Chart drag must move the visible range");
    await evaluate('document.getElementById("boardResetChart").click()');
    assert.equal(await evaluate('document.getElementById("boardChartCaption").textContent'),fiveMinute);
    await evaluate('document.getElementById("boardMA5").click();document.getElementById("boardMA20").click()');
    assert.equal(await evaluate('document.querySelectorAll("#boardChart path").length'),0);
    await evaluate('document.getElementById("boardMA5").click();document.getElementById("boardMA20").click()');
    const responsive=[];
    for(const width of [1440,1024,390,320]) {
      await send("Emulation.setDeviceMetricsOverride",{width,height:1200,deviceScaleFactor:1,mobile:width<768});
      await pause(150);
      const dimensions=await evaluate('({scroll:document.documentElement.scrollWidth,width:innerWidth,chart:document.getElementById("boardChart").getBoundingClientRect().width})');
      assert.ok(dimensions.scroll<=width+1,`Market board overflow at ${width}: ${JSON.stringify(dimensions)}`);
      assert.ok(dimensions.chart>200);
      assert.equal(await evaluate('document.querySelector("#boardChart text").getAttribute("font-size")'),"13","Chart labels should remain readable on mobile");
      const capture=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
      fs.writeFileSync(path.join(scratch,`market-board-${width}.png`),Buffer.from(capture.data,"base64"));
      responsive.push({width,...dimensions});
    }
    await send("Emulation.setDeviceMetricsOverride",{width:1440,height:1200,deviceScaleFactor:1,mobile:false});
    await evaluate('document.getElementById("marketBoardPanel").scrollIntoView({block:"start"})');
    const screenshot=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    fs.writeFileSync(path.join(root,"web/public/images/screenshots/market-board.png"),Buffer.from(screenshot.data,"base64"));
    await evaluate('document.querySelector("[data-product=index]").click();document.getElementById("boardStart").value="2026-10-01";document.getElementById("boardEnd").value="2026-10-08";document.getElementById("boardMode").value="history";document.getElementById("boardMode").dispatchEvent(new Event("change"))');
    await until('document.getElementById("boardChartCaption").textContent.includes("6／6") && document.getElementById("boardChartCaption").textContent.includes("2026-10-01")');
    assert.equal(await evaluate('document.getElementById("boardChartType").value'),"line");
    assert.equal(await evaluate('document.querySelectorAll("#boardChart path").length'),3,"Short historical ranges must retain MA20 through warmup");
    assert.equal(await evaluate('document.getElementById("boardMonitor").disabled'),true);
    assert.equal(await evaluate('document.getElementById("boardBookRows").children.length'),0);
    await evaluate('document.querySelector("[data-product=night]").click()');
    await until('document.getElementById("boardChartCaption").textContent.includes("6／6") && document.getElementById("boardChartTitle").textContent.includes("夜盤")');
    assert.equal(await evaluate('document.getElementById("boardBookRows").children.length'),0);
    await evaluate('selectSection("basic",false)');
    await until('state.equityData!==null');
    assert.doesNotMatch(await evaluate('document.getElementById("basicPanel").textContent'),/完成 \d+ 個資料集|付費項目不以免費數字替代|股利政策/);
    await evaluate('document.querySelector("[data-app-page=market]").click();document.querySelector("[data-product=index]").click();document.querySelector("[data-market-tab=technical]").click()');
    await until('document.querySelectorAll("#boardTechnicalMetrics .board-metric").length===6 && document.querySelector("#boardTechnicalMetrics .board-metric strong").textContent!=="—"');
    assert.equal(await evaluate('document.getElementById("sectionNav").hidden'),true);
    assert.equal(await evaluate('document.getElementById("boardOrderbook").hidden'),true);
    await evaluate('document.getElementById("marketChipsDate").value="2026-10-08";document.querySelector("[data-market-tab=chips]").click()');
    await until('document.querySelectorAll("#marketChipsRows tr").length===6');
    assert.ok(await evaluate('document.querySelectorAll(".chip-bar-row").length>=3'));
    await evaluate('document.querySelector("[data-market-chips=margin]").click()');
    assert.equal(await evaluate('document.querySelectorAll("#marketChipsRows tr").length'),3);
    assert.match(await evaluate('document.getElementById("marketChipsRows").textContent'),/億元/);
    assert.equal(await evaluate('document.getElementById("marketChipsChart").hidden'),true);
    await evaluate('document.querySelector("[data-market-chips=futures]").click()');
    assert.equal(await evaluate('document.querySelectorAll("#marketChipsRows tr").length'),3);
    await evaluate('document.querySelector("[data-market-chips=institutional]").click();document.getElementById("marketBoardPanel").scrollIntoView({block:"start"})');
    const chipsScreenshot=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    fs.writeFileSync(path.join(root,"web/public/images/screenshots/market-chips.png"),Buffer.from(chipsScreenshot.data,"base64"));
    await evaluate('document.querySelector("[data-app-page=stock]").click();document.getElementById("stockInput").value="2409";document.getElementById("searchForm").dispatchEvent(new Event("submit",{cancelable:true}));');
    await until('state.stock.symbol==="2409"');
    await evaluate('document.querySelector("[data-section=news]").click();document.getElementById("mediaStart").value="2026-10-08";document.getElementById("mediaEnd").value="2026-10-08";document.getElementById("mediaForm").dispatchEvent(new Event("submit",{cancelable:true}));');
    await until('document.querySelectorAll("#companyNews .media-item").length>0 && document.querySelectorAll("#companyDiscussions .media-item").length>0');
    assert.match(await evaluate('document.getElementById("mediaCompanyTitle").textContent'),/友達/);
    assert.equal(await evaluate('document.querySelectorAll("#companyNews .media-item").length<=6 && document.querySelectorAll("#companyDiscussions .media-item").length<=6'),true);
    assert.equal(await evaluate('Array.from(document.querySelectorAll(".media-headline")).every(a=>a.href.startsWith("https://") && a.rel.includes("noopener"))'),true);
    for(const width of [1440,1024,390,320]) {
      await send("Emulation.setDeviceMetricsOverride",{width,height:1200,deviceScaleFactor:1,mobile:width<768});await pause(100);
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`News overflow ${width}`);
      await evaluate('document.getElementById("newsPanel").scrollIntoView({block:"start"})');
      const shot=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});fs.writeFileSync(path.join(scratch,`news-${width}.png`),Buffer.from(shot.data,"base64"));
      if(width===1440)fs.writeFileSync(path.join(root,"web/public/images/screenshots/company-news.png"),Buffer.from(shot.data,"base64"));
    }
    await evaluate('document.getElementById("stockInput").value="2330";document.getElementById("searchForm").dispatchEvent(new Event("submit",{cancelable:true}));');
    await until('state.stock.symbol==="2330" && document.getElementById("mediaCompanyTitle").textContent.includes("台積電")');
    assert.doesNotMatch(await evaluate('document.getElementById("companyNews").textContent'),/友達營收/);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({status:"passed",day,night,fiveMinute,hourly,responsive,indexHistory:6,nightHistory:6,screenshot:"web/public/images/screenshots/market-board.png"}));
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
