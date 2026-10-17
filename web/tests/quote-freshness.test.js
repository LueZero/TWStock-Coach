import test from "node:test";
import assert from "node:assert/strict";
import { observedQuote } from "../src/models/quote-freshness.js";

test("未收到新快照時，畫面延遲與跨日狀態仍隨時鐘更新；失敗不恢復健康燈號", () => {
  const quote = {
    source_time: "2026-10-16T02:00:00Z",
    trade_date: "2026-10-16",
    state: "snapshot",
    age_seconds: 0,
  };
  assert.equal(observedQuote(quote, "2026-10-16T02:00:30Z").state, "snapshot");
  assert.equal(observedQuote(quote, "2026-10-16T02:02:01Z").state, "delayed");
  assert.equal(
    observedQuote(quote, "2026-10-16T06:00:00Z").state,
    "after_close",
  );
  assert.equal(
    observedQuote(quote, "2026-10-17T02:00:00Z").state,
    "previous_session",
  );
  assert.equal(observedQuote(quote, "2026-10-16T02:02:01Z").age_seconds, 121);
  assert.equal(
    observedQuote({ ...quote, state: "unavailable" }, "2026-10-16T02:00:30Z")
      .state,
    "unavailable",
  );
  assert.equal(quote.state, "snapshot", "來源快照本體不可被時鐘改寫");
});
