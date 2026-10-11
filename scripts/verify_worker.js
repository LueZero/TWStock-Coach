import assert from "node:assert/strict";
import { rows, pool } from "../api/db.js";

try {
  const [lock] = await rows(`SELECT count(*)::int AS owners FROM pg_locks
    WHERE locktype='advisory' AND granted AND objsubid=2
      AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
      AND classid=hashtext(current_schema())::oid AND objid=78241006`);
  assert.equal(
    lock.owners,
    1,
    "No exclusive worker owns this schema; check scheduler logs",
  );
  const active = await rows(`SELECT status,count(*)::int AS count,
    max(EXTRACT(EPOCH FROM now()-started_at))::int AS oldest_wait_seconds,
    max(EXTRACT(EPOCH FROM now()-heartbeat_at))::int AS heartbeat_age_seconds
    FROM job_runs WHERE status IN ('queued','running') GROUP BY status`);
  const running = active.find((job) => job.status === "running");
  assert.ok(
    !running ||
      (running.heartbeat_age_seconds != null &&
        running.heartbeat_age_seconds < 120),
    "Running job heartbeat is missing or older than 120 seconds; check worker and database",
  );
  console.log(
    JSON.stringify({
      status: "passed",
      worker_lock_owners: lock.owners,
      active_jobs: active,
    }),
  );
} finally {
  await pool.end();
}
