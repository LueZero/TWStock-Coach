import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
process.loadEnvFile();
const base = process.env.ASSISTANT_URL || "http://127.0.0.1:8010";
let cookie = "";
async function request(path, body, authenticated = true) {
  const r = await fetch(base + "/api/assistant" + path, {
    ...(body !== undefined
      ? {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authenticated ? { Cookie: cookie } : {}),
          },
          body: JSON.stringify(body),
        }
      : { headers: authenticated ? { Cookie: cookie } : {} }),
    signal: AbortSignal.timeout(60000),
  });
  return { status: r.status, data: await r.json(), headers: r.headers };
}
assert.equal((await request("/reports", undefined, false)).status, 401);
const login = await request("/login", {
  access_key: process.env.ASSISTANT_ACCESS_KEY,
});
assert.equal(login.status, 200);
cookie = login.headers.get("set-cookie").split(";")[0];
assert.match(login.headers.get("set-cookie"), /HttpOnly/);
const rejected = await fetch(base + "/api/assistant/reports", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Cookie: cookie,
    Origin: "https://attacker.example",
  },
  body: "{}",
});
assert.equal(rejected.status, 403);
const stockBase = process.env.STOCK_API_URL || "http://127.0.0.1:8000";
assert.equal((await fetch(stockBase + "/api/assistant/status")).status, 404);
const packetResponse = await fetch(stockBase + "/api/research/report-input", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    market: "TWSE",
    symbol: "2409",
    mode: "latest",
    start: "2026-04-01",
    message: "請分析進場觀察與退出條件，缺資料請直接說。",
  }),
});
assert.ok(packetResponse.ok);
const packet = await packetResponse.json();
const latest = await request("/reports", packet);
assert.equal(latest.status, 202, JSON.stringify(latest.data));
assert.equal(latest.data.report.meta.symbol, "2409");
assert.ok(latest.data.report.evidence.some((e) => e.id === "price:last"));
assert.ok(latest.data.report.quality.length);
const job = await request("/reports/" + latest.data.report.id);
assert.equal(job.status, 200);
assert.equal(
  (await request(`/reports/${latest.data.report.id}`, undefined, false)).status,
  401,
);
await mkdir(".tmp", { recursive: true });
await writeFile(
  ".tmp/assistant-report-id.json",
  JSON.stringify({
    report_id: latest.data.report.id,
  }),
);
console.log(
  JSON.stringify({
    status: "passed",
    report: latest.data.report.id,
    ai: latest.data.status,
    evidence: latest.data.report.evidence.length,
    scenarios: latest.data.report.scenarios.length,
    bars: latest.data.report.chart_bars.length,
    quality: latest.data.report.quality.length,
    facets: latest.data.report.facets.map((f) => [f.id, f.state]),
  }),
);
