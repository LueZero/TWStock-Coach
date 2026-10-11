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
      'document.readyState === "complete" && document.getElementById("historyRows").children.length > 0',
    );
    await evaluate('document.querySelector("[data-app-page=market]").click()');
    await until(
      'document.querySelectorAll(".market-board-card").length===3 && document.querySelectorAll("#boardChart path").length>0',
    );
    await evaluate('document.querySelector("[data-product=night]").click()');
    await until(
      'document.getElementById("boardBookRows").children.length===5 && document.getElementById("boardChartTitle").textContent.includes("夜盤")',
    );
    const results = [];
    const sizes = [
      [1920, 1080],
      [1440, 900],
      [1366, 768],
      [1280, 720],
      [1024, 768],
    ];
    async function fit(view, width, height) {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await evaluate("window.scrollTo(0,0)");
      await pause(180);
      const layout = await evaluate(
        `({height:innerHeight,width:innerWidth,clientWidth:document.documentElement.clientWidth,clientHeight:document.documentElement.clientHeight,scrollHeight:document.documentElement.scrollHeight,scrollWidth:document.documentElement.scrollWidth,panelBottom:document.getElementById("marketBoardPanel").getBoundingClientRect().bottom,chartHeight:document.getElementById("boardChart").getBoundingClientRect().height,visibleRows:[...document.querySelectorAll("#boardBookRows tr,#marketChipsRows tr")].filter(e=>e.getBoundingClientRect().height>0).map(e=>({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom}))})`,
      );
      assert.ok(
        layout.scrollHeight <= layout.clientHeight + 1,
        `${view} ${width}x${height} requires vertical scroll: ${JSON.stringify(layout)}`,
      );
      assert.ok(
        layout.scrollWidth <= layout.clientWidth + 1,
        `${view} horizontal overflow ${JSON.stringify(layout)}`,
      );
      assert.ok(
        layout.panelBottom <= height,
        `${view} panel not fully visible`,
      );
      for (const row of layout.visibleRows)
        assert.ok(
          row.top >= 60 && row.bottom <= height,
          `${view} row below viewport`,
        );
      if (view !== "chips")
        assert.ok(layout.chartHeight >= 140, `${view} chart too small`);
      const spills = await evaluate(
        'Array.from(document.querySelectorAll("#boardOrderbook > *,#boardTechnicalMetrics .board-metric > *")).filter(e=>e.getBoundingClientRect().height>0).filter(e=>{const r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return r.top<p.top-1||r.bottom>p.bottom+1||r.left<p.left-1||r.right>p.right+1}).map(e=>e.textContent)',
      );
      assert.deepEqual(
        spills,
        [],
        `${view} card contents escaped their container at ${width}x${height}`,
      );
      results.push({ view, width, height, ...layout });
      const shot = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
      });
      fs.writeFileSync(
        path.join(scratch, `market-layout-${view}-${width}-${height}.png`),
        Buffer.from(shot.data, "base64"),
      );
      if (width === 1440 && view === "live")
        fs.writeFileSync(
          path.join(root, "web/public/images/screenshots/market-board.png"),
          Buffer.from(shot.data, "base64"),
        );
      if (width === 1440 && view === "chips")
        fs.writeFileSync(
          path.join(root, "web/public/images/screenshots/market-chips.png"),
          Buffer.from(shot.data, "base64"),
        );
    }
    for (const [width, height] of sizes) await fit("live", width, height);
    assert.equal(
      await evaluate(
        'document.querySelector("#boardBookRows tr").children.length',
      ),
      5,
    );
    assert.equal(
      await evaluate(
        'getComputedStyle(document.querySelector("#boardBookRows td:nth-child(2)")).fontSize===getComputedStyle(document.querySelector("#bookRows td:nth-child(2)")).fontSize',
      ),
      true,
    );
    assert.match(
      await evaluate('document.getElementById("boardBookBalance").textContent'),
      /五檔合計/,
    );
    assert.match(
      await evaluate('document.getElementById("boardBookNote").textContent'),
      /1 口＝1\s+份期貨契約/,
    );
    await evaluate(
      'document.querySelector("[data-product=index]").click();document.getElementById("boardStart").value="2026-10-01";document.getElementById("boardEnd").value="2026-10-08";document.querySelector("[data-market-tab=technical]").click()',
    );
    await until(
      'document.getElementById("boardChartCaption").textContent.includes("6／6") && document.querySelectorAll("#boardTechnicalMetrics .board-metric").length===6',
    );
    for (const [width, height] of sizes) await fit("technical", width, height);
    assert.equal(
      await evaluate('document.getElementById("boardOrderbook").hidden'),
      true,
    );
    await evaluate(
      'document.getElementById("marketChipsDate").value="2026-10-08";document.querySelector("[data-market-tab=chips]").click()',
    );
    await until('document.querySelectorAll("#marketChipsRows tr").length===6');
    for (const [width, height] of sizes) await fit("chips", width, height);
    for (const subtab of ["margin", "futures"]) {
      await evaluate(
        `document.querySelector('[data-market-chips="${subtab}"]').click()`,
      );
      for (const [width, height] of [
        [1280, 720],
        [1024, 768],
      ])
        await fit("chips", width, height);
      assert.equal(
        await evaluate(
          'document.querySelectorAll("#marketChipsRows tr").length',
        ),
        3,
      );
    }
    await evaluate(
      'document.querySelector("[data-market-tab=live]").click();document.querySelector("[data-product=night]").click()',
    );
    await until('document.getElementById("boardBookRows").children.length===5');
    for (const width of [390, 320]) {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await pause(180);
      assert.equal(
        await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),
        true,
        `Mobile horizontal overflow ${width}`,
      );
      assert.equal(
        await evaluate(
          'getComputedStyle(document.querySelector("#boardBookRows td:nth-child(2)")).fontSize===getComputedStyle(document.querySelector("#bookRows td:nth-child(2)")).fontSize',
        ),
        true,
      );
    }
    await evaluate(
      'document.querySelector("[data-app-page=calculator]").click()',
    );
    assert.equal(await evaluate("document.body.dataset.page"), "calculator");
    assert.equal(
      await evaluate('document.getElementById("calculatorPanel").hidden'),
      false,
    );
    assert.equal(
      await evaluate(
        'document.getElementById("sectionNav").hidden && document.querySelector(".stock-header").hidden && document.querySelector(".quote-strip").hidden',
      ),
      true,
    );
    assert.equal(
      await evaluate('document.querySelector("[data-section=calculator]")'),
      null,
    );
    assert.equal(
      await evaluate(
        'document.querySelectorAll("[data-app-page=calculator][aria-pressed=true]").length',
      ),
      2,
    );
    assert.equal(
      await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),
      true,
    );
    await evaluate('document.querySelector("[data-app-page=stock]").click()');
    assert.equal(
      await evaluate(
        'document.getElementById("calculatorPanel").hidden && !document.getElementById("sectionNav").hidden && !document.querySelector(".stock-header").hidden',
      ),
      true,
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        status: "passed",
        desktop: results,
        mobile: [390, 320],
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
