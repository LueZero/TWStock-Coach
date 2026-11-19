import assert from "node:assert/strict";
const base = process.env.API_BASE_URL ?? "http://127.0.0.1:8000";
const webBase = process.env.WEB_BASE_URL ?? process.env.BASE_URL;
const timings = {};
async function request(
  path,
  { method = "GET", body, json = true, origin = base } = {},
) {
  const response = await fetch(origin + path, {
    method,
    signal: AbortSignal.timeout(30000),
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  assert.equal(response.status, 200, path);
  return json ? response.json() : response.text();
}
async function section(name, query = "") {
  const path = `/api/stock-data/TWSE/2409?section=${name}${query}`;
  const start = performance.now();
  let result;
  do {
    result = await request(path);
    if (result.state !== "updating") break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (performance.now() - start < 60000);
  assert.ok(
    ["ready", "partial"].includes(result.state),
    JSON.stringify({ name, state: result.state, update: result.update }),
  );
  assert.equal(result.database_used, false);
  assert.equal(result.storage, "memory");
  timings[name] = Math.round(performance.now() - start);
  return result.data;
}
const health = await request("/health");
assert.equal(health.status, "ok");
assert.equal(health.data_mode, "source_api");
assert.equal(health.database_used, false);
assert.equal((await request("/")).service, "TWStock Coach API");
for (const path of [
  "/assets/index.js",
  "/images/screenshots/dashboard.png",
  "/src/main.js",
])
  assert.equal(
    (await fetch(base + path)).status,
    404,
    "API must not serve frontend",
  );
for (const path of ["/openapi.json", "/docs/"])
  assert.ok(await request(path, { json: false }));
if (webBase) {
  const html = await request("/", { json: false, origin: webBase });
  assert.match(html, /股票智能助手/);
  const assets = [
    ...html.matchAll(/(?:src|href)="(\/(?:assets|src)\/[^"?]+)/g),
  ].map((m) => m[1]);
  assert.ok(assets.length);
  for (const path of assets)
    assert.ok(await request(path, { json: false, origin: webBase }));
}
assert.ok(
  (await request("/api/search?q=2409")).some((r) => r.symbol === "2409"),
);
const quote = await request("/api/quote/TWSE/2409");
assert.equal(quote.database_used, false);
assert.equal(quote.bids.length, 5);
assert.equal(quote.asks.length, 5);
const chart = await section(
  "chart",
  "&start=2026-10-01&end=2026-10-08&resolution=1d",
);
assert.equal(chart.data.length, 6);
assert.ok(chart.data.every((r) => r.close > 0 && r.volume >= 0));
const basic = await section("basic", "&start=2026-10-01&end=2026-10-08");
assert.ok(
  basic.coverage.some(
    (r) => r.dataset === "CompanyProfile" && r.status === "available",
  ),
);
const financial = await section("financial");
assert.ok(financial.metrics.some((r) => r.value != null));
const equity = await section("equity", "&start=2026-11-01&end=2026-11-20");
assert.ok(equity.coverage.some((r) => r.status === "available"));
assert.ok(equity.details.distribution.length > 0);
const peers = await request(
  "/api/peers/TWSE/2409?reference=2026-11-20&view_mode=latest&alignment=common",
);
assert.equal(peers.database_used, false);
assert.ok(peers.rows.some((r) => r.symbol === "2409"));
const news = await request(
  "/api/media/TWSE/2409?start=2026-11-14&end=2026-11-20&source=recent",
);
assert.ok(Array.isArray(news.news) && Array.isArray(news.discussions));
const body = {
  market: "TWSE",
  symbol: "2409",
  start: "2026-10-01",
  end: "2026-10-08",
  resolution: "1d",
  price_basis: "raw",
};
await request("/api/strategy/analyze", { method: "POST", body });
const replay = await request("/api/strategy/backtest", {
  method: "POST",
  body,
});
assert.equal(replay.bars, 6);
console.log(
  JSON.stringify({
    status: "passed",
    database_used: false,
    sections: 8,
    financial_metrics: financial.metrics.filter((r) => r.value != null).length,
    distribution_rows: equity.details.distribution.length,
    replay_bars: replay.bars,
    timings_ms: timings,
  }),
);
