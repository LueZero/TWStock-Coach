import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateBoardMinutes } from "../src/models/market-board-model.js";

test("hour candles anchor to futures opening and incomplete trailing buckets stay forming", () => {
  const rows = [526, 527, 585, 586].map((minute, i) => ({
    label: String(minute),
    session_minute: minute,
    session_start_minute: 525,
    open: 100 + i,
    high: 110 + i,
    low: 90 + i,
    close: 101 + i,
    volume: 2,
    is_final: true,
  }));
  const result = aggregateBoardMinutes(rows, 60);
  assert.equal(result.length, 2);
  assert.equal(result[0].volume, 6);
  assert.equal(result[0].close, 103);
  assert.equal(result[0].is_final, true);
  assert.equal(result[1].is_final, false);
  assert.equal(aggregateBoardMinutes(rows, 60, true)[1].is_final, true);
});
