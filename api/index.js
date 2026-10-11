import { config } from "./config.js";
import { initialize, pool } from "./db.js";
import { createApp } from "./api.js";
import { runWorker } from "./jobs.js";
await initialize();
const app = await createApp({ logger: true }),
  controller = new AbortController();
let worker = null;
await app.listen({ host: config.host, port: config.port });
if (process.env.RUN_WORKER === "true")
  worker = runWorker({ signal: controller.signal, schedule: true });
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  controller.abort();
  await app.close();
  if (worker) await worker;
  await pool.end();
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
