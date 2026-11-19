import test from "node:test";
import assert from "node:assert/strict";
import { resource, clearSourceCache } from "../../api/source-cache.js";
import { config } from "../../api/config.js";
import { access, readFile } from "node:fs/promises";
import { createApp } from "../../api/api.js";
test("來源服務沒有DB驅動與初始化，保留舊匯入的認證邊界", async () => {
  const pkg = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url)),
  );
  assert.equal(pkg.dependencies.pg, undefined);
  for (const path of [
    "db.js",
    "jobs.js",
    "cli.js",
    "migrations/001_initial.sql",
  ])
    await assert.rejects(
      access(new URL("../../api/" + path, import.meta.url)),
      { code: "ENOENT" },
    );
  assert.equal("databaseEnabled" in config, false);
  const previousKey = config.ingestKey;
  config.ingestKey = "unit-test-import-key";
  const app = await createApp();
  try {
    const r = await app.inject("/health");
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().database_used, false);
    const jobs = await app.inject("/api/jobs");
    assert.deepEqual(jobs.json(), []);
    const load = await app.inject({
      method: "POST",
      url: "/api/history/load",
      payload: {
        market: "TWSE",
        symbol: "2330",
        start: "2026-10-01",
        end: "2026-10-08",
      },
    });
    assert.equal(load.statusCode, 410);
    const payload = {
      market: "TWSE",
      symbol: "2409",
      dataset: "FundHoldingsReport",
      source: "unit-test",
      rows: [{}],
    };
    const denied = await app.inject({
      method: "POST",
      url: "/api/equity/import",
      payload,
    });
    assert.equal(denied.statusCode, 401);
    const removed = await app.inject({
      method: "POST",
      url: "/api/equity/import",
      payload,
      headers: { "x-api-key": config.ingestKey },
    });
    assert.equal(removed.statusCode, 410);
    const spec = (await app.inject("/openapi.json")).json();
    assert.deepEqual(spec.paths["/api/equity/import"].post.security, [
      { ingestKey: [] },
    ]);
  } finally {
    config.ingestKey = previousKey;
    await app.close();
  }
});
test("記憶體來源合併重複查詢，失敗時保留來源狀態，清除快取不留歷史", async () => {
  clearSourceCache();
  let calls = 0,
    finish;
  const load = () => {
    calls++;
    return new Promise((r) => (finish = r));
  };
  const a = resource("test", load),
    b = resource("test", load);
  assert.equal(a, b);
  await Promise.resolve();
  assert.equal(calls, 1);
  finish({ rows: [1] });
  await a.promise;
  assert.equal(a.pending, false);
  assert.deepEqual(a.value.rows, [1]);
  const oldAt = a.at;
  a.at = 0;
  const failed = resource(
    "test",
    async () => {
      throw Error("offline");
    },
    1,
  );
  await failed.promise;
  assert.deepEqual(failed.value.rows, [1]);
  assert.match(failed.error, /未以DB/);
  assert.ok(oldAt > 0);
  clearSourceCache();
  const clean = resource("test", async () => ({ rows: [] }));
  assert.equal(clean.value, undefined);
  await clean.promise;
  assert.deepEqual(clean.value.rows, []);
});
