// One-time migration. Does not delete legacy tables or modify source reports.
import { rows, pool } from "../api/db.js";
import { createReportStore } from "../agent/report-store.js";
const store = createReportStore(process.env.ASSISTANT_REPORT_DIR || "reports");
try {
  const exists = (
    await rows("SELECT to_regclass('assistant_reports') AS name")
  )[0].name;
  if (!exists) {
    console.log("No legacy reports to export.");
    process.exitCode = 0;
  } else {
    const reports = await rows(
      "SELECT r.id,r.data,s.data AS input FROM assistant_reports r JOIN assistant_snapshots s ON s.id=r.snapshot_id ORDER BY r.created_at",
    );
    let count = 0;
    for (const row of reports) {
      const messages = await rows(
        "SELECT role,content,created_at FROM assistant_messages WHERE report_id=$1 ORDER BY id",
        [row.id],
      );
      const old = (
        await rows(
          "SELECT status,kind,error,usage FROM assistant_jobs WHERE report_id=$1 ORDER BY created_at DESC LIMIT 1",
          [row.id],
        )
      )[0];
      const run = {
        ...old,
        status: ["running", "queued"].includes(old?.status)
          ? "interrupted"
          : old?.status || "completed",
      };
      // Never overwrite an already exported file (it may now have agent follow-ups).
      try {
        await store.load(row.id);
        continue;
      } catch (e) {
        if (e.statusCode !== 404) throw e;
      }
      await store.save({
        format_version: 1,
        report: row.data,
        input: row.input,
        messages,
        session_id: null,
        run,
        legacy_import: true,
      });
      count++;
    }
    console.log(
      JSON.stringify({
        exported: count,
        total: reports.length,
        format: "report.md + report.json",
        directory: store.root,
      }),
    );
  }
} finally {
  await pool.end();
}
