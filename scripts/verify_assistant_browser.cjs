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
    'JSON.stringify({symbol:state.stock.symbol,financialStatus:document.getElementById("financialStatus")?.textContent,historyStatus:document.getElementById("historyStatus")?.textContent,assistantStatus:document.getElementById("assistantStatus")?.textContent,reportSelection:document.getElementById("assistantHistory")?.value,reportOptions:Array.from(document.getElementById("assistantHistory")?.options||[]).map(o=>o.value),reportText:document.getElementById("assistantContent")?.textContent.slice(0,300)})',
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
      'document.readyState === "complete" && typeof globalThis.stockCoach?.selectSection === "function"',
    );
    process.loadEnvFile();
    const saved = JSON.parse(
      fs.readFileSync(
        process.env.CHAT_FIXTURE_PATH ||
          path.join(scratch, "assistant-chat-id.json"),
        "utf8",
      ),
    );
    const accessKey =
      process.env.ASSISTANT_TEST_ACCESS_KEY || process.env.ASSISTANT_ACCESS_KEY;
    await evaluate(`globalThis.stockCoach.selectSection('assistant',false)`);
    await evaluate(
      `(async()=>{const r=await fetch('/api/assistant/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({access_key:${JSON.stringify(accessKey)}})});if(!r.ok)throw Error('Login failed');globalThis.stockCoach.selectSection('assistant',false);})()`,
    );
    await until(
      `document.querySelector('[data-session-id="${saved.session_id}"]')`,
    );
    await evaluate(
      `document.querySelector('[data-session-id="${saved.session_id}"]').click()`,
    );
    await until(`document.querySelectorAll('.chat-artifact-card').length>=2`);
    assert.ok(
      await evaluate(
        `getComputedStyle(document.getElementById('searchForm')).display==='none' && !document.getElementById('chatNewStock')`,
      ),
    );
    await evaluate(
      `document.getElementById('chatMessages').scrollTop=document.getElementById('chatMessages').scrollHeight`,
    );
    await pause(400);
    const capture = async (file) => {
      const result = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
      });
      fs.writeFileSync(file, Buffer.from(result.data, "base64"));
    };
    await capture(path.join(root, "web/public/images/screenshots/ai-chat.png"));
    await evaluate(
      `Array.from(document.querySelectorAll('.chat-artifact-card')).find(b=>b.textContent.includes('研究報告')).click()`,
    );
    await until(`document.getElementById('chatArtifactDialog').open`);
    assert.ok(
      await evaluate(
        `document.getElementById('chatArtifactContent').textContent.length>100&&document.querySelector('.chat-artifact-download').href.includes('/artifacts/')`,
      ),
    );
    await evaluate(
      `document.getElementById('chatArtifactClose').click();Array.from(document.querySelectorAll('.chat-artifact-card')).find(b=>b.textContent.includes('K 線')).click()`,
    );
    await until(`document.querySelectorAll('.chat-chart path').length>3`);
    assert.ok(
      await evaluate(
        `document.querySelectorAll('.chat-chart [data-technical-event]').length>0`,
      ),
    );
    await capture(
      path.join(root, "web/public/images/screenshots/ai-chat-chart.png"),
    );
    await evaluate(
      `document.querySelector('.chat-chart-tools select').value='momentum';document.querySelector('.chat-chart-tools select').dispatchEvent(new Event('change'))`,
    );
    assert.ok(
      await evaluate(
        `Array.from(document.querySelectorAll('.chat-chart [data-technical-event]')).every(e=>/MACD|KD/.test(e.dataset.technicalEvent))`,
      ),
    );
    await evaluate(`document.getElementById('chatArtifactClose').click()`);
    for (const width of [1024, 390, 320]) {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await pause(250);
      const sizes = await evaluate(
        `({width:innerWidth,body:document.body.scrollWidth,thread:document.querySelector('.chat-thread').getBoundingClientRect().width})`,
      );
      assert.ok(sizes.body <= sizes.width + 1, JSON.stringify(sizes));
      assert.ok(sizes.thread > 200);
    }
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1200,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(
      `document.getElementById('chatSessionDrawer').open=true;document.getElementById('chatNewSession').click()`,
    );
    await until(
      `!document.getElementById('assistantSend').disabled&&document.querySelector('.chat-welcome')`,
    );
    const first = await evaluate(
      `document.querySelector('.chat-session[aria-pressed="true"]').dataset.sessionId`,
    );
    await evaluate(
      `document.getElementById('assistantMessage').value='介面測試第一問：只回覆「回答已保存」，不用查資料。';document.getElementById('assistantMessageForm').requestSubmit()`,
    );
    await until(`!document.getElementById('assistantCancel').hidden`);
    await until(
      `!document.getElementById('assistantSend').disabled&&document.getElementById('chatMessages').textContent.includes('回答已保存')`,
    );
    const scope = await evaluate(
      `document.getElementById('chatScope').textContent`,
    );
    await evaluate(
      `document.getElementById('stockInput').value='2883';document.getElementById('searchForm').requestSubmit()`,
    );
    await until(`state.stock.symbol==='2883'`);
    assert.equal(
      await evaluate(`document.getElementById('chatScope').textContent`),
      scope,
    );
    await evaluate(`document.getElementById('chatNewSession').click()`);
    await until(
      `!document.getElementById('assistantSend').disabled&&document.querySelector('.chat-welcome')`,
    );
    const second = await evaluate(
      `document.querySelector('.chat-session[aria-pressed="true"]').dataset.sessionId`,
    );
    assert.notEqual(first, second);
    assert.ok(
      !(
        await evaluate(`document.getElementById('chatMessages').textContent`)
      ).includes("介面測試第一問"),
    );
    await evaluate(
      `document.getElementById('assistantMessage').value='第二段草稿';document.getElementById('assistantMessage').dispatchEvent(new Event('input'));document.querySelector('[data-session-id="${first}"]').click()`,
    );
    await until(
      `document.querySelector('.chat-session[aria-pressed="true"]').dataset.sessionId==='${first}'&&!document.getElementById('assistantSend').disabled`,
    );
    assert.ok(
      (
        await evaluate(`document.getElementById('chatMessages').textContent`)
      ).includes("介面測試第一問"),
    );
    await evaluate(
      `document.querySelector('[data-session-id="${second}"]').click()`,
    );
    await until(
      `document.querySelector('.chat-session[aria-pressed="true"]').dataset.sessionId==='${second}'&&!document.getElementById('assistantSend').disabled`,
    );
    assert.equal(
      await evaluate(`document.getElementById('assistantMessage').value`),
      "第二段草稿",
    );
    await evaluate(
      `document.getElementById('assistantMessageForm').requestSubmit()`,
    );
    await until(`!document.getElementById('assistantCancel').hidden`);
    await evaluate(`document.getElementById('assistantCancel').click()`);
    await until(
      `document.getElementById('assistantCancel').hidden&&!document.getElementById('assistantSend').disabled`,
    );
    assert.ok(
      (
        await evaluate(`document.getElementById('chatMessages').textContent`)
      ).match(/已停止|取消/),
    );
    await send("Page.reload");
    await until(
      `document.readyState==='complete'&&typeof globalThis.stockCoach?.selectSection==='function'`,
    );
    await evaluate(`globalThis.stockCoach.selectSection('assistant',false)`);
    await until(
      `document.querySelector('.chat-session[aria-pressed="true"]')?.dataset.sessionId==='${second}'`,
    );
    assert.equal(errors.length, 0, JSON.stringify(errors));
    console.log(
      JSON.stringify({
        status: "passed",
        sessionIsolation: true,
        stockIsolation: true,
        drafts: true,
        streaming: true,
        cancellation: true,
        reload: true,
        artifacts: true,
        responsive: [1440, 1024, 390, 320],
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
