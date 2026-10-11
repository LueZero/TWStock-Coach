import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
const root = new URL("../", import.meta.url),
  template = await readFile(new URL(".env.example", root), "utf8");
const text = template
  .replace(
    "replace-with-a-long-random-password",
    randomBytes(32).toString("base64url"),
  )
  .replace(
    "replace-with-a-random-api-key",
    randomBytes(32).toString("base64url"),
  );
try {
  await writeFile(new URL(".env", root), text, { flag: "wx", mode: 0o600 });
  console.log(
    "Created .env with random credentials. Credentials are not printed.",
  );
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log(".env already exists; kept unchanged.");
}
