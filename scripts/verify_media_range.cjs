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
    await evaluate(`
      window.newsQueries=[];
      window.newsRealFetch=window.fetch;
      window.fetch=async (input,options)=>{
        const url=new URL(String(input),location.origin);
        if(!url.pathname.startsWith('/api/media/'))return window.newsRealFetch(input,options);
        const start=url.searchParams.get('start'),end=url.searchParams.get('end'),day=url.searchParams.get('cursor');
        window.newsQueries.push({start,end,day});
        await new Promise(r=>setTimeout(r,100));
        const next=day<end?new Date(Date.parse(day)+86400000).toISOString().slice(0,10):null;
        return new Response(JSON.stringify({start,end,date:day,next_cursor:next,
          news:[{title:'公司新聞 '+day,url:'https://example.com/news?SN='+day,published_at:day+'T09:00:00',timezone_known:false,source:'測試來源',relation:'公司索引'}],
          discussions:[],failed_dates:day==='2026-10-07'?[day]:[],
          sources:[{id:'finmind',label:'公司索引',available:day!=='2026-10-07',count:1}],notes:[],searches:[]}),{status:200,headers:{'Content-Type':'application/json'}});
      };
      document.querySelector('[data-section=news]').click();
      document.getElementById('mediaStart').value='2026-10-06';
      document.getElementById('mediaEnd').value='2026-10-08';
      window.newsQueries=[];
      document.getElementById('mediaForm').dispatchEvent(new Event('submit',{cancelable:true}));
    `);
    await until(
      'document.getElementById("mediaStatus").textContent.includes("資料不完整")',
    );
    assert.deepEqual(await evaluate("newsQueries.map(q=>q.day)"), [
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
    ]);
    assert.equal(
      await evaluate(
        'document.querySelectorAll("#companyNews .media-item").length',
      ),
      3,
    );
    assert.match(
      await evaluate('document.getElementById("mediaStatus").textContent'),
      /2026-10-07/,
    );
    await evaluate('document.querySelector(`[data-media-days="1"]`).click()');
    await until(
      'document.getElementById("mediaStatus").textContent.includes("區間查詢完成")',
    );
    assert.equal(
      await evaluate(
        'document.getElementById("mediaStart").value===document.getElementById("mediaEnd").value',
      ),
      true,
    );
    await evaluate('document.querySelector(`[data-media-days="7"]`).click()');
    await until(
      'document.getElementById("mediaStatus").textContent.includes("公司索引區間")',
    );
    assert.equal(
      await evaluate(
        '(Date.parse(document.getElementById("mediaEnd").value)-Date.parse(document.getElementById("mediaStart").value))/86400000',
      ),
      6,
    );
    await evaluate('document.querySelector(`[data-media-days="30"]`).click()');
    await until(
      'document.getElementById("mediaStatus").textContent.includes("公司索引區間")',
    );
    assert.equal(
      await evaluate(
        '(Date.parse(document.getElementById("mediaEnd").value)-Date.parse(document.getElementById("mediaStart").value))/86400000',
      ),
      29,
    );
    const queriesBefore = await evaluate("newsQueries.length");
    await evaluate(
      'document.getElementById("mediaStart").value="2026-10-09";document.getElementById("mediaEnd").value="2026-10-08";document.getElementById("mediaForm").dispatchEvent(new Event("submit",{cancelable:true}))',
    );
    assert.match(
      await evaluate('document.getElementById("mediaStatus").textContent'),
      /有效起訖/,
    );
    assert.equal(await evaluate("newsQueries.length"), queriesBefore);
    await evaluate(
      'document.getElementById("mediaStart").value="2026-10-06";document.getElementById("mediaEnd").value="2026-10-08";document.getElementById("mediaForm").dispatchEvent(new Event("submit",{cancelable:true}));document.querySelector(`[data-media-days="1"]`).click()',
    );
    await until(
      'document.getElementById("mediaStatus").textContent.includes("區間查詢完成")',
    );
    assert.equal(
      await evaluate(
        'document.querySelectorAll("#companyNews .media-item").length',
      ),
      1,
    );
    const savedRange = await evaluate(
      '[document.getElementById("mediaStart").value,document.getElementById("mediaEnd").value]',
    );
    await evaluate(
      'document.getElementById("stockInput").value="2409";document.getElementById("searchForm").dispatchEvent(new Event("submit",{cancelable:true}));',
    );
    await until(
      'state.stock.symbol==="2409" && document.getElementById("mediaCompanyTitle").textContent.includes("友達")',
    );
    assert.deepEqual(
      await evaluate(
        '[document.getElementById("mediaStart").value,document.getElementById("mediaEnd").value]',
      ),
      savedRange,
    );
    await evaluate(
      'window.fetch=window.newsRealFetch;document.getElementById("mediaStart").value="2026-10-07";document.getElementById("mediaEnd").value="2026-10-08";document.getElementById("mediaForm").dispatchEvent(new Event("submit",{cancelable:true}));',
    );
    await until(
      'document.getElementById("mediaStatus").textContent.includes("2026-10-07～2026-10-08") && document.getElementById("mediaStatus").textContent.includes("區間查詢完成")',
    );
    assert.ok(
      await evaluate(
        'document.querySelectorAll("#companyNews .media-item").length>0',
      ),
    );
    for (const width of [1440, 1024, 390, 320]) {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 1200,
        deviceScaleFactor: 1,
        mobile: width < 768,
      });
      await pause(100);
      assert.equal(
        await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),
        true,
        "News range overflow " + width,
      );
      await evaluate(
        'document.getElementById("newsPanel").scrollIntoView({block:"start"})',
      );
      const shot = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
      });
      fs.writeFileSync(
        path.join(scratch, "news-range-" + width + ".png"),
        Buffer.from(shot.data, "base64"),
      );
      if (width === 1440)
        fs.writeFileSync(
          path.join(root, "web/public/images/screenshots/company-news.png"),
          Buffer.from(shot.data, "base64"),
        );
    }
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        status: "passed",
        rangeDays: 3,
        presets: [1, 7, 30],
        partialCoverage: true,
        cancellation: true,
        widths: [1440, 1024, 390, 320],
        source: "isolated browser fixtures; no DB write",
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
