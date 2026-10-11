import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { initialize, pool } from "./db.js";
import {
  runWorker,
  enqueueWatchlist,
  enqueue,
  watchlist,
  waitForJobs,
} from "./jobs.js";
import { ingest } from "./service.js";
import { validDate, fail } from "./lib.js";
const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      start: { type: "string" },
      end: { type: "string" },
      file: { type: "string" },
    },
  }),
  command = positionals[0];
const controller = new AbortController();
process.on("SIGTERM", () => controller.abort());
process.on("SIGINT", () => controller.abort());
try {
  await initialize();
  if (values.start) validDate(values.start);
  if (values.end) validDate(values.end);
  switch (command) {
    case "init":
      console.log("Database schema is ready.");
      break;
    case "sync": {
      const ids = await enqueueWatchlist(values.start, values.end);
      await runWorker({ signal: controller.signal, once: true });
      await waitForJobs(ids, controller.signal);
      break;
    }
    case "schedule":
      await runWorker({ signal: controller.signal, schedule: true });
      break;
    case "fundamentals": {
      const ids = [];
      for (const s of watchlist())
        ids.push((await enqueue("fundamentals", s, true)).job_id);
      await runWorker({ signal: controller.signal, once: true });
      await waitForJobs(ids, controller.signal);
      break;
    }
    case "import":
      if (!values.file) fail("--file is required");
      console.log(
        await ingest(JSON.parse(await readFile(values.file, "utf8"))),
      );
      break;
    default:
      fail(
        "Usage: node api/cli.js init|sync|schedule|fundamentals|import [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--file file.json]",
      );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
