import assert from "node:assert/strict";
const base = process.env.API_BASE_URL ?? "http://127.0.0.1:8000";
const webBase = process.env.WEB_BASE_URL ?? process.env.BASE_URL;
async function request(path, json = true, origin = base) {
  const r = await fetch(origin + path, { signal: AbortSignal.timeout(30000) });
  assert.equal(r.status, 200, path);
  return json ? r.json() : r.text();
}
const health = await request("/health");
assert.equal(health.status, "ok");
assert.equal(health.timezone, "Asia/Taipei");
assert.equal(health.runtime, "nodejs");
const info = await request("/");
assert.equal(info.service, "TWStock Coach API");
for (const path of [
  "/assets/index.js",
  "/images/screenshots/dashboard.png",
  "/src/main.js",
])
  assert.equal(
    (await fetch(base + path)).status,
    404,
    "API must not serve frontend: " + path,
  );
if (webBase) {
  const html = await request("/", false, webBase);
  assert.match(html, /股票智能助手/);
  const assets = [
    ...html.matchAll(/(?:src|href)="(\/(?:assets|src)\/[^"?]+)/g),
  ].map((match) => match[1]);
  assert.ok(assets.length, "Frontend entry has no build or development assets");
  for (const path of assets) assert.ok(await request(path, false, webBase));
}
for (const path of ["/openapi.json", "/docs/"])
  assert.ok(await request(path, false));
const instruments = await request("/api/instruments");
await request("/api/jobs");
assert.equal(
  typeof (await request("/api/market/status")).monitor_allowed,
  "boolean",
);
for (const pair of [
  ...new Set(
    instruments
      .filter((i) => i.timeframe === "1d" && i.session === "daily_aggregate")
      .map((i) => i.market + "/" + i.symbol),
  ),
]) {
  const result = await request("/api/bars/" + pair + "?limit=1"),
    latest = result.data[0];
  if (latest) {
    const chart = await request(
      "/api/chart/" +
        pair +
        "?start=" +
        latest.trade_date +
        "&end=" +
        latest.trade_date,
    );
    assert.equal(chart.data.length, 1);
    assert.equal(chart.data[0].close, latest.close);
    console.log(
      pair,
      "latest=" + latest.trade_date,
      "MA5=" + latest.analysis?.ma5,
    );
  }
}
console.log(
  "Node.js API isolation, schema, jobs and stored charts passed" +
    (webBase ? "; independent frontend assets passed." : "."),
);
