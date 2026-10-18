try {
  process.loadEnvFile();
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const { createAgent } = await import("./server.js");
const app = createAgent();
await app.listen({
  host: process.env.ASSISTANT_HOST || "127.0.0.1",
  port: Number(process.env.ASSISTANT_PORT || 8010),
});
console.log("看盤Chat已啟動；Session存於sessions，Codex只在送出訊息時啟動。");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    process.exit();
  });
