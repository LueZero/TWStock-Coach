import pg from "pg";
import { readFile } from "node:fs/promises";
import { config } from "./config.js";
// Preserve dates as YYYY-MM-DD and timestamps with timezone, matching the API contract.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n))
    throw Error("Database integer exceeds safe range");
  return n;
});
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  ...(config.schema ? { options: "-c search_path=" + config.schema } : {}),
});
pool.on("error", (error) =>
  console.error("Database pool error:", error.code ?? "unknown"),
);
export const query = (text, values = []) => pool.query(text, values);
export const rows = async (text, values = []) =>
  normalize((await query(text, values)).rows);
export const normalize = (records) =>
  records.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        value instanceof Date ? value.toISOString() : value,
      ]),
    ),
  );
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function initialize() {
  const sql = await readFile(
    new URL("./migrations/001_initial.sql", import.meta.url),
    "utf8",
  );
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(78241000)");
    await client.query(sql);
  });
}
