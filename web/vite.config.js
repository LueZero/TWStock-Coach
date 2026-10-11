import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const apiTarget = process.env.API_PROXY_TARGET || "http://127.0.0.1:8000";
const agentTarget =
  process.env.ASSISTANT_PROXY_TARGET || "http://127.0.0.1:8010";
const proxy = {
  "/api/assistant": { target: agentTarget, changeOrigin: true },
  ...Object.fromEntries(
    ["/api", "/health", "/docs", "/openapi.json"].map((path) => [
      path,
      { target: apiTarget, changeOrigin: true },
    ]),
  ),
};

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    proxy,
  },
  build: { outDir: "dist", emptyOutDir: true },
});
