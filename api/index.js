import { config } from "./config.js";
import { createApp } from "./api.js";
const app = await createApp({ logger: true });
await app.listen({ host: config.host, port: config.port });
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
