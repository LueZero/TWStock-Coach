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
async function until(expression, timeout = 60000) {
  const deadline = Date.now() + timeout;
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
    process.loadEnvFile();
    const saved = JSON.parse(
      fs.readFileSync(path.join(scratch, "assistant-report-id.json"), "utf8"),
    );
    const symbol = saved.symbol || "2409";
    await evaluate(
      `document.getElementById('stockInput').value=${JSON.stringify(symbol)};document.getElementById('searchForm').requestSubmit()`,
    );
    await until(`state.stock.symbol===${JSON.stringify(symbol)}`);
    if (saved.expected_day) {
      await until(
        `state.rows.at(-1)?.trade_date===${JSON.stringify(saved.expected_day)} && state.quote?.trade_date===${JSON.stringify(saved.expected_day)}`,
      );
      assert.equal(
        await evaluate(`document.getElementById('endDate').value`),
        saved.expected_day,
      );
      assert.ok(
        await evaluate(
          `document.getElementById('connectionState').textContent==='今日已收盤'`,
        ),
      );
    }
    await evaluate(`selectSection('assistant',false)`);
    assert.ok(
      await evaluate(
        `document.getElementById('assistantRangeMode').value==='auto' && document.getElementById('assistantStartLabel').hidden`,
      ),
    );
    await evaluate(
      `document.getElementById('assistantRangeMode').value='manual'; document.getElementById('assistantRangeMode').dispatchEvent(new Event('change'))`,
    );
    assert.ok(
      await evaluate(`!document.getElementById('assistantStartLabel').hidden`),
    );
    await evaluate(
      `document.getElementById('assistantRangeMode').value='auto'; document.getElementById('assistantRangeMode').dispatchEvent(new Event('change'))`,
    );
    assert.ok(
      await evaluate(
        `['assistantCapital','assistantRisk','assistantShares','assistantCost','assistantDiscount','assistantMinimum'].every(id=>document.getElementById(id)===null)`,
      ),
    );
    await until(`!document.getElementById('assistantLogin').hidden`);
    await evaluate(
      `document.getElementById('assistantAccessKey').value=${JSON.stringify(process.env.ASSISTANT_ACCESS_KEY)};document.getElementById('assistantLogin').requestSubmit()`,
    );
    await until(
      `document.getElementById('assistantLogin').hidden && document.getElementById('assistantHistory').options.length>1`,
    );
    if (saved.failed_report_id) {
      await evaluate(
        `document.getElementById('assistantHistory').value=${JSON.stringify(saved.failed_report_id)};document.getElementById('assistantHistory').dispatchEvent(new Event('change'))`,
      );
      await until(
        `document.getElementById('assistantContent').textContent.includes('本次分析未完成')`,
      );
      assert.ok(
        !(
          await evaluate(
            `document.getElementById('assistantContent').textContent`,
          )
        ).includes("正在整理資料與產生AI摘要"),
      );
    }
    await evaluate(
      `document.getElementById('assistantHistory').value=${JSON.stringify(saved.report_id)};document.getElementById('assistantHistory').dispatchEvent(new Event('change'))`,
    );
    await until(
      `document.getElementById('assistantContent').textContent.includes('AI 重點摘要')`,
    );
    if (saved.structured) {
      if (saved.streamed) {
        await until(
          `!document.getElementById('assistantProgress').hidden && document.getElementById('assistantProgressEvents').children.length>0`,
        );
        assert.ok(
          await evaluate(
            `document.getElementById('assistantProgressConnection').textContent.length>0`,
          ),
        );
      }
      await until(
        `document.querySelectorAll('.assistant-research-card').length===7`,
        240000,
      );
      assert.equal(
        await evaluate(
          `document.querySelectorAll('.assistant-research-card').length`,
        ),
        7,
      );
      assert.equal(
        await evaluate(
          `document.querySelectorAll('.assistant-action-card').length`,
        ),
        3,
      );
      assert.ok(
        await evaluate(
          `document.querySelector('.assistant-report-windows').textContent.length>30`,
        ),
      );
      await evaluate(
        `document.querySelector('.assistant-action-tabs [data-action="holding"]').click()`,
      );
      assert.ok(
        await evaluate(
          `!document.querySelector('.assistant-action-card.holding').hidden && document.querySelector('.assistant-action-card.entry').hidden`,
        ),
      );
      await evaluate(
        `document.querySelector('.assistant-action-tabs [data-action="entry"]').click()`,
      );
      await evaluate(
        `Array.from(document.querySelectorAll('.assistant-report-nav button')).find(b=>b.textContent==='財務').click()`,
      );
      await pause(400);
      assert.ok(
        await evaluate(
          `document.getElementById('assistantContent').scrollTop>100`,
        ),
      );
      await evaluate(`document.getElementById('assistantContent').scrollTop=0`);
    }
    for (const tab of ["plan", "evidence", "quality", "chart", "summary"]) {
      await evaluate(
        `document.querySelector('[data-report-tab="${tab}"]').click()`,
      );
      assert.ok(
        await evaluate(
          `document.getElementById('assistantContent').textContent.length>30`,
        ),
        tab,
      );
      if (tab === "plan") {
        assert.ok(
          await evaluate(
            `document.querySelectorAll('.assistant-observation').length>=7`,
          ),
        );
      }
    }
    await until(`!document.getElementById('assistantGenerate').disabled`);
    assert.ok(
      await evaluate(
        `document.getElementById('assistantContent').textContent.includes('AI 重點摘要')`,
      ),
    );
    assert.equal(
      await evaluate(
        `document.querySelectorAll('#assistantContent a[download]').length`,
      ),
      2,
    );
    await until(
      `document.getElementById('assistantMessages').children.length>=2`,
    );
    for (const width of [1440, 1024, 390, 320]) {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: width < 600,
      });
      await pause(250);
      const size = await evaluate(
        `({width:innerWidth,scroll:document.documentElement.scrollWidth})`,
      );
      assert.ok(size.scroll <= size.width + 1, JSON.stringify(size));
    }
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await pause(300);
    const imageDir = path.join(root, "web/public/images/screenshots");
    fs.mkdirSync(imageDir, { recursive: true });
    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(imageDir, "ai-report.png"),
      Buffer.from(shot.data, "base64"),
    );
    await evaluate(
      `document.querySelector('[data-report-tab="chart"]').click()`,
    );
    await until(`document.querySelector('.assistant-chart rect')`);
    if (symbol === "2883") {
      assert.ok(
        await evaluate(
          `document.querySelectorAll('[data-technical-event]').length>0`,
        ),
      );
      await evaluate(
        `document.querySelector('.assistant-chart rect[role=button]').dispatchEvent(new MouseEvent('mouseenter'))`,
      );
      assert.ok(
        await evaluate(
          `document.querySelector('.assistant-chart-readout').textContent.includes('收 ')`,
        ),
      );
    }
    const first = await evaluate(
      `document.querySelector('.assistant-chart-tools span').textContent`,
    );
    await evaluate(
      `Array.from(document.querySelectorAll('.assistant-chart-tools button')).find(b=>b.textContent==='放大').click()`,
    );
    assert.notEqual(
      await evaluate(
        `document.querySelector('.assistant-chart-tools span').textContent`,
      ),
      first,
    );
    const chartShot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(imageDir, "ai-report-chart.png"),
      Buffer.from(chartShot.data, "base64"),
    );
    await evaluate(`document.getElementById('assistantToggleChat').click()`);
    assert.equal(
      await evaluate(
        `document.getElementById('assistantChat').getBoundingClientRect().width`,
      ),
      0,
    );
    await evaluate(`document.getElementById('assistantToggleChat').click()`);
    await evaluate(
      `document.querySelector('.assistant-chart rect[role=button]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`,
    );
    assert.equal(
      await evaluate(`document.getElementById('assistantMode').value`),
      "historical",
    );
    await evaluate(
      `Array.from(document.querySelectorAll('#assistantContent button')).find(b=>b.textContent==='回個股看盤工作台').click()`,
    );
    await until(
      `state.rows.length>0 && document.getElementById('chartDescription').textContent.includes('報告')`,
    );
    assert.ok(
      await evaluate(
        `document.getElementById('chartDescription').textContent.includes('固定條件線')`,
      ),
    );
    await evaluate(`state.rows.at(-1).revision++;plot()`);
    assert.ok(
      await evaluate(
        `document.getElementById('chartDescription').textContent.includes('條件線已隱藏')`,
      ),
    );
    await evaluate(`selectSection('assistant',false)`);
    await evaluate(
      `state.stock={market:'TWSE',symbol:'2330',name:'台積電',industry:'半導體'};document.dispatchEvent(new CustomEvent('stock-coach:stock'))`,
    );
    assert.ok(
      !(
        await evaluate(
          `document.getElementById('assistantContent').textContent`,
        )
      ).includes("MA20"),
    );
    assert.equal(errors.length, 0, JSON.stringify(errors));
    console.log(
      JSON.stringify({
        status: "passed",
        tabs: 5,
        widths: [1440, 1024, 390, 320],
        reportSwitch: true,
        chartZoom: true,
        historicalBar: true,
        chatCollapse: true,
        stockIsolation: true,
        screenshots: 2,
      }),
    );
  } finally {
    if (ws?.readyState === WebSocket.OPEN) {
      try {
        await send("Browser.close");
      } catch {}
      ws.close();
    }
    child.kill();
  }
})().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
