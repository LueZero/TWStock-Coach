import test from "node:test";
import assert from "node:assert/strict";
import { createSourceBudget } from "../../api/source-budget.js";
import { stockMediaRange } from "../../api/media.js";
import { sourceQueue } from "../../api/source-queue.js";

test("前景查詢優先背景工作；開啟正在背景載入的個股可提升原工作，不重複查詢", async () => {
  const queue = sourceQueue();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const order = [];
  const active = queue(() => gate);
  const news = queue(async () => {
    order.push("news");
  }, 0);
  const other = queue(async () => {
    order.push("other");
  }, 1);
  const promoted = queue(
    async () => {
      order.push("selected");
    },
    0,
    "financial:TWSE:2409",
  );
  queue.promote("financial:TWSE:2409", 2);
  release();
  await Promise.all([active, news, other, promoted]);
  assert.deepEqual(order, ["selected", "other", "news"]);
  await assert.rejects(
    queue(async () => {
      throw Error("offline");
    }),
    /offline/,
  );
  await queue(async () => {
    order.push("recovered");
  });
  assert.equal(order.at(-1), "recovered");
});

test("來源容許少量連續查詢但不超過滾動一小時額度", () => {
  let stamp = 0;
  const budget = createSourceBudget(2, () => stamp);
  budget.consume();
  stamp = 1800000;
  budget.consume();
  assert.equal(budget.status().remaining, 0);
  assert.throws(
    () => budget.consume(),
    (e) =>
      e.code === "SOURCE_BUDGET" &&
      e.statusCode === 429 &&
      e.retryAfterMs === 1800000,
  );
  stamp = 3600000;
  assert.equal(budget.status().remaining, 1);
  budget.consume();
  assert.equal(budget.status().remaining, 0);
  stamp = 7200000;
  assert.equal(budget.status().remaining, 2);
});

test("近期新聞一次取區間，不等待逐日索引；索引查詢不混入RSS", async () => {
  const calls = [];
  const load = async (market, symbol, day, options) => {
    calls.push({ market, symbol, day, options });
    return {
      news: [],
      discussions: [],
      sources: [
        {
          id: options.source === "index" ? "finmind" : "yahoo",
          available: true,
        },
      ],
      notes: [],
    };
  };
  const recent = await stockMediaRange(
    "TWSE",
    "2409",
    { start: "2026-10-01", end: "2026-10-08", source: "recent" },
    load,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.end, "2026-10-08");
  assert.equal(recent.next_cursor, null);
  const index = await stockMediaRange(
    "TWSE",
    "2409",
    { start: "2026-10-01", end: "2026-10-08", source: "index" },
    load,
  );
  assert.equal(calls[1].options.source, "index");
  assert.equal(index.next_cursor, "2026-10-02");
  assert.deepEqual(index.failed_dates, []);
});
