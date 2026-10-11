// Requires a report created by verify_assistant_api.js. Makes one real AI call.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
process.loadEnvFile();
const base = process.env.ASSISTANT_URL || "http://127.0.0.1:8010";
const saved = JSON.parse(
  await readFile(".tmp/assistant-report-id.json", "utf8"),
);
let cookie;
async function request(path, body) {
  const response = await fetch(base + "/api/assistant" + path, {
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  assert.ok(response.ok, JSON.stringify(data));
  return { data, response };
}
const login = await request("/login", {
  access_key: process.env.ASSISTANT_ACCESS_KEY,
});
cookie = login.response.headers.get("set-cookie").split(";")[0];
const before = (await request("/reports/" + saved.report_id)).data;
assert.ok(before.report.ai, "initial real AI report must be completed");
const queued = (
  await request(`/reports/${saved.report_id}/messages`, {
    message: "請簡短說明還沒買時應該等什麼訊號，只使用本報告資料。",
  })
).data;
assert.equal(queued.status, "running");
let job;
for (let i = 0; i < 65; i++) {
  job = (await request("/reports/" + queued.report_id)).data.run;
  if (job.status !== "running") break;
  await new Promise((r) => setTimeout(r, 2000));
}
assert.equal(job.status, "completed", job.error || job.status);
const after = (await request("/reports/" + saved.report_id)).data;
assert.equal(after.report.snapshot_id, before.report.snapshot_id);
assert.deepEqual(
  after.report.ai,
  before.report.ai,
  "follow-up must not overwrite initial report",
);
assert.ok(after.messages.length > before.messages.length);
assert.equal(
  after.session_id,
  before.session_id,
  "must resume the same CLI session",
);
console.log(
  JSON.stringify({
    status: "passed",
    sameSnapshot: true,
    originalReportPreserved: true,
    usage: job.usage,
    sameCliSession: after.session_id === before.session_id,
  }),
);
