import test from "node:test";
import assert from "node:assert/strict";
import { dailySourceEnd } from "../../api/lib.js";
import { marketStatus } from "../../api/trading.js";
import { resolveCodexBinary } from "../codex-binary.js";
test("台北交易日盤中不載入未完成日K，盤後可載入當日資料", () => {
  assert.equal(dailySourceEnd("2026-10-12T09:00:00+08:00"), "2026-10-11");
  assert.equal(dailySourceEnd("2026-10-12T14:29:59+08:00"), "2026-10-11");
  assert.equal(dailySourceEnd("2026-10-12T14:30:00+08:00"), "2026-10-12");
  assert.equal(dailySourceEnd("2026-10-13T00:01:00+08:00"), "2026-10-12");
});
test("狀態區分開盤前、盤中、已收盤與休市", async () => {
  const calendarReader = async () => ({
    known: true,
    closed: {},
    source: "test",
  });
  assert.equal(
    (await marketStatus("2026-10-12T08:50:00+08:00", calendarReader)).phase,
    "preopen",
  );
  const open = await marketStatus("2026-10-12T10:00:00+08:00", calendarReader);
  assert.equal(open.phase, "open");
  assert.equal(open.monitor_allowed, true);
  assert.equal(
    (await marketStatus("2026-10-12T22:00:00+08:00", calendarReader)).phase,
    "after_close",
  );
  assert.equal(
    (await marketStatus("2026-10-11T10:00:00+08:00", calendarReader)).phase,
    "closed",
  );
});
test("明確指定的CLI執行檔不被自動偵測覆蓋", () => {
  assert.equal(resolveCodexBinary("custom-codex"), "custom-codex");
});
