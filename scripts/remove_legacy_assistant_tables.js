// Only removes the retired assistant tables after verifying exported report content.
import assert from "node:assert/strict";
import { rows, transaction, pool } from "../api/db.js";
import { createReportStore } from "../agent/report-store.js";
const store = createReportStore(process.env.ASSISTANT_REPORT_DIR || "reports");
try {
  if (
    !(await rows("SELECT to_regclass('assistant_reports') AS name"))[0].name
  ) {
    console.log("Legacy assistant tables already removed.");
  } else {
    const reports = await rows(
      "SELECT r.id,r.data,s.data AS input FROM assistant_reports r JOIN assistant_snapshots s ON s.id=r.snapshot_id",
    );
    for (const row of reports) {
      const doc = await store.load(row.id);
      assert.deepEqual(doc.report, row.data, "exported report mismatch");
      assert.deepEqual(doc.input, row.input, "exported input mismatch");
    }
    await transaction(async (client) => {
      await client.query(
        "DROP TABLE IF EXISTS assistant_messages,assistant_jobs,assistant_reports,assistant_snapshots,assistant_access_sessions,assistant_worker_status",
      );
    });
    console.log(
      JSON.stringify({
        verifiedReports: reports.length,
        removedTables: 6,
        stockTables: "unchanged",
      }),
    );
  }
} finally {
  await pool.end();
}
