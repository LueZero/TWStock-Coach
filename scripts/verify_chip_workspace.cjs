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
  if (response.exceptionDetails)
    throw Error(
      response.exceptionDetails.exception?.description ||
        response.exceptionDetails.text,
    );
  return response.result.value;
}
async function until(expression) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await pause(300);
  }
  const diagnostics = await evaluate(
    'JSON.stringify({financialStatus:document.getElementById("financialStatus")?.textContent,historyStatus:document.getElementById("historyStatus")?.textContent})',
  );
  throw Error(
    "UI wait failed: " +
      expression +
      " " +
      diagnostics +
      " " +
      JSON.stringify(errors),
  );
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
    const target = await send("Target.createTarget", {
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
      height: 1200,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await send("Page.navigate", { url: base });
    await until(
      'document.readyState === "complete" && globalThis.stockCoach && state.rows.length>0',
    );
    await evaluate(
      'document.getElementById("stockInput").value="2409";document.getElementById("searchForm").dispatchEvent(new Event("submit",{cancelable:true}));',
    );
    await until('state.stock.symbol==="2409" && state.rows.length>0');
    await evaluate('selectSection("chips",false)');
    await until("state.equityData?.workspace?.institutions.length>0");
    assert.equal(
      await evaluate('document.querySelectorAll("[data-chip-tab]").length'),
      9,
    );
    assert.ok(
      await evaluate('document.querySelectorAll("#chipChart rect").length>0'),
    );
    await evaluate(
      'document.getElementById("volumeUnit").value="shares";document.getElementById("volumeUnit").dispatchEvent(new Event("change"))',
    );
    const before = await evaluate(
      'document.getElementById("chipTableRows").firstChild.children[1].textContent',
    );
    await evaluate(
      'document.getElementById("volumeUnit").value="lots";document.getElementById("volumeUnit").dispatchEvent(new Event("change"))',
    );
    const after = await evaluate(
      'document.getElementById("chipTableRows").firstChild.children[1].textContent',
    );
    assert.ok(
      Math.abs(
        Number(before.replaceAll(",", "")) / 1000 -
          Number(after.replaceAll(",", "")),
      ) < 0.001,
    );
    for (const tab of [
      "institutional",
      "main-force",
      "broker",
      "major-holders",
      "shareholding-distribution",
      "margin-trading",
      "director-holder",
      "insider-transactions",
      "fund-holdings",
    ]) {
      await evaluate(
        'document.querySelector("[data-chip-tab="+' +
          JSON.stringify(tab) +
          '+"]").click()',
      );
      assert.ok(
        await evaluate(
          'document.getElementById("chipTableHead").children.length===1',
        ),
      );
      assert.equal(
        await evaluate(
          'document.querySelectorAll("#chipTabs [aria-selected=true]").length',
        ),
        1,
      );
    }
    await evaluate(
      'document.querySelector("[data-chip-tab=shareholding-distribution]").click()',
    );
    assert.ok(
      (
        await evaluate('document.getElementById("chipTableRows").textContent')
      ).includes("24.52"),
    );
    await evaluate(
      'const el=document.querySelector("#chipControls select[aria-label=散戶門檻]");el.value="50";el.dispatchEvent(new Event("change"))',
    );
    assert.ok(
      await evaluate(
        'document.getElementById("chipTableHead").textContent.includes("散戶")',
      ),
    );
    const responsive = [];
    for (const [width, height] of [
      [1440, 900],
      [1024, 768],
      [390, 844],
      [320, 740],
    ]) {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await evaluate("window.scrollTo(0,0)");
      await pause(200);
      assert.equal(
        await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),
        true,
        "chips overflow " + width,
      );
      responsive.push(width);
      if (width === 1440) {
        await evaluate(
          'document.querySelector("[data-chip-tab=institutional]").click();document.getElementById("chipPanel").scrollIntoView({block:"start"})',
        );
        const shot = await send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: false,
        });
        fs.writeFileSync(
          path.join(root, "web/public/images/screenshots/stock-chips.png"),
          Buffer.from(shot.data, "base64"),
        );
      }
    }
    await evaluate(
      'document.getElementById("startDate").value="2026-10-08";document.getElementById("endDate").value="2026-10-08";document.getElementById("applyDates").click()',
    );
    await until(
      'state.equityData?.start==="2026-10-08" && state.equityData?.end==="2026-10-08"',
    );
    assert.equal(
      await evaluate("state.equityData.workspace.institutions.length"),
      1,
    );
    assert.equal(await evaluate("state.equityData.history.foreign.length"), 1);
    await evaluate(
      'document.querySelector("[data-chip-tab=margin-trading]").click()',
    );
    assert.ok(
      (
        await evaluate('document.getElementById("chipTableRows").textContent')
      ).includes("310,016"),
    );
    await evaluate(
      'document.querySelector("[data-chip-tab=director-holder]").click()',
    );
    assert.ok(
      await evaluate('document.querySelectorAll("#chipTableRows tr").length>1'),
    );
    await evaluate(
      'document.querySelector("#chipTableRows .chip-row-action").click()',
    );
    await until(
      'document.getElementById("insightModal").classList.contains("show")',
    );
    await evaluate(
      'bootstrap.Modal.getInstance(document.getElementById("insightModal")).hide()',
    );
    await pause(350);
    await evaluate(
      'document.getElementById("stockInput").value="2330";document.getElementById("searchForm").dispatchEvent(new Event("submit",{cancelable:true}));',
    );
    await until('state.stock.symbol==="2330" && state.rows.length>0');
    await evaluate('selectSection("chips",false)');
    await until('state.equityData?.symbol==="2330"');
    assert.equal(
      await evaluate(
        'document.getElementById("chipStatus").textContent.includes("友達")',
      ),
      false,
    );
    // Browser-only fixtures exercise controls whose real sources require membership.
    // Nothing is imported into the API or persisted in PostgreSQL.
    await evaluate(
      'state.equityData.workspace.branches=[{date:"2026-10-07",id:"A",name:"測試分點A",buy:200,sell:100,net:100},{date:"2026-10-08",id:"A",name:"測試分點A",buy:100,sell:20,net:80},{date:"2026-10-08",id:"B",name:"測試分點B",buy:5,sell:100,net:-95}];document.getElementById("volumeUnit").value="shares";document.getElementById("volumeUnit").dispatchEvent(new Event("change"));document.querySelector("[data-chip-tab=broker]").click()',
    );
    assert.equal(
      await evaluate(
        'document.getElementById("chipTableRows").firstChild.children[3].textContent',
      ),
      "180",
    );
    await evaluate(
      'const select=document.querySelector("#chipControls select[aria-label=統計方式]");select.value="day";select.dispatchEvent(new Event("change"))',
    );
    assert.equal(
      await evaluate(
        'document.getElementById("chipTableRows").firstChild.children[3].textContent',
      ),
      "80",
    );
    await evaluate(
      'document.querySelector("#chipTableRows .chip-row-action").click()',
    );
    await until(
      'document.getElementById("insightModal").classList.contains("show")',
    );
    assert.equal(await evaluate("state.insight.points.length"), 2);
    await evaluate(
      'bootstrap.Modal.getInstance(document.getElementById("insightModal")).hide()',
    );
    await pause(350);
    await evaluate(
      'state.equityData.workspace.funds=[{fund_code:"T",fund_name:"測試基金",holding_shares:200,weight_percent:3,weight_change:1,date:"2026-10-08",comparison_date:"2026-09-30"}];state.equityData.workspace.fund_history=[{fund_code:"T",date:"2026-10-07",holding_shares:100},{fund_code:"T",date:"2026-10-08",holding_shares:200}];document.querySelector("[data-chip-tab=fund-holdings]").click();document.querySelector("#chipTableRows .chip-row-action").click()',
    );
    await until(
      'document.getElementById("insightModal").classList.contains("show")',
    );
    assert.equal(await evaluate("state.insight.points.length"), 2);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        status: "passed",
        tabs: 9,
        responsive,
        sharesLots: "passed",
        dateRange: "passed",
        directorModal: "passed",
        stockSwitch: "passed",
        screenshot: "web/public/images/screenshots/stock-chips.png",
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
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
