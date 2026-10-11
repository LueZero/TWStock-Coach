try {
  process.loadEnvFile();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
export const config = {
  databaseUrl:
    process.env.DATABASE_URL ?? "postgresql://stock:stock@localhost:5432/stock",
  port: Number(process.env.PORT ?? 8000),
  host: process.env.HOST ?? "0.0.0.0",
  ingestKey: process.env.INGEST_API_KEY ?? "",
  schema: process.env.DATABASE_SCHEMA ?? null,
};
if (config.schema && !/^[a-z][a-z0-9_]{0,62}$/.test(config.schema))
  throw Error("Invalid database schema");
