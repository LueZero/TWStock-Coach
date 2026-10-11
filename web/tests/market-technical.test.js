import { test } from "node:test";
import assert from "node:assert/strict";
import { closeMetrics } from "../src/models/market-technical-model.js";
test("Index indicators use completed closes, require warmup and do not fabricate high-low indicators", () => {
  const data = Array.from({ length: 60 }, (_, i) => ({
    close: 100 + i,
    is_final: true,
    label: String(i),
  }));
  const metrics = closeMetrics([...data, { close: 10000, is_final: false }]);
  assert.equal(metrics.ma5, 157);
  assert.equal(metrics.ma20, 149.5);
  assert.equal(metrics.ma60, 129.5);
  assert.equal(metrics.rsi14, 100);
  assert.ok(Number.isFinite(metrics.histogram));
  assert.equal(metrics.k, undefined);
  assert.equal(closeMetrics(data.slice(0, 5)).rsi14, null);
  assert.equal(closeMetrics(data.slice(0, 25)).macd, null);
  assert.equal(closeMetrics(data.slice(0, 30)).signal, null);
  assert.equal(closeMetrics(data.map((r) => ({ ...r, close: 100 }))).rsi14, 50);
});
