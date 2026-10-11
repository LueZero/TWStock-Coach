import test from "node:test";
import assert from "node:assert/strict";
import {
  mediaRange,
  filterMediaRange,
  stockMediaRange,
  mergeMedia,
} from "../api/media.js";

test("新聞區間含兩端與假日，兼容單日，拒絕錯誤區間", () => {
  assert.deepEqual(mediaRange({}, "2026-10-11"), {
    start: "2026-10-05",
    end: "2026-10-11",
    cursor: "2026-10-05",
  });
  assert.equal(
    mediaRange({ date: "2026-10-08" }, "2026-10-11").start,
    "2026-10-08",
  );
  assert.equal(
    mediaRange({ start: "2026-09-11", end: "2026-10-11" }, "2026-10-11").end,
    "2026-10-11",
  );
  for (const query of [
    { start: "2026-10-08" },
    { start: "2026-10-09", end: "2026-10-08" },
    { start: "2026-09-10", end: "2026-10-11" },
    { date: "2026-10-12" },
    { date: "2026-02-30" },
    { date: "2026-10-08", end: "2026-10-08" },
    { start: "2026-10-07", end: "2026-10-08", cursor: "2026-10-09" },
  ])
    assert.throws(() => mediaRange(query, "2026-10-11"));
});

test("RSS 依台北日期跨日篩選，未知時區公司索引保留原日期", () => {
  const items = [
    { published_at: "2026-10-07T16:00:00Z" },
    { published_at: "2026-10-08T15:59:59Z" },
    { published_at: "2026-10-08T16:00:00Z" },
    { published_at: "2026-10-08T23:59:59", timezone_known: false },
    { published_at: "invalid" },
  ];
  assert.deepEqual(filterMediaRange(items, "2026-10-08", "2026-10-08"), [
    items[0],
    items[1],
    items[3],
  ]);
});

test("區間查詢逐日翻頁，假日不跳過，失敗日期明確保留", async () => {
  const queried = [],
    failed = [];
  let cursor;
  const loader = async (market, symbol, date) => {
    queried.push([market, symbol, date]);
    return {
      date,
      news: [],
      discussions: [],
      sources: [{ id: "finmind", available: date !== "2026-10-10", count: 0 }],
    };
  };
  do {
    const result = await stockMediaRange(
      "TWSE",
      "2409",
      { start: "2026-10-09", end: "2026-10-11", ...(cursor ? { cursor } : {}) },
      loader,
    );
    failed.push(...result.failed_dates);
    cursor = result.next_cursor;
  } while (cursor);
  assert.deepEqual(
    queried.map((q) => q[2]),
    ["2026-10-09", "2026-10-10", "2026-10-11"],
  );
  assert.deepEqual(failed, ["2026-10-10"]);
});

test("區間合併去重保留文章識別參數，不截斷 60 筆", () => {
  const items = Array.from({ length: 75 }, (_, i) => ({
    url: `https://example.com/news?SN=${i}`,
    published_at: "2026-10-08T10:00:00",
  }));
  assert.equal(
    mergeMedia(
      [...items, { ...items[0], url: items[0].url + "&utm_source=rss" }],
      Infinity,
    ).length,
    75,
  );
});
