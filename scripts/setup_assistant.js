import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
const file = new URL("../.env", import.meta.url);
let content = await readFile(file, "utf8");
for (const name of ["ASSISTANT_ACCESS_KEY"]) {
  const expression = new RegExp("^" + name + "=(.*)$", "m"),
    match = expression.exec(content);
  if (match?.[1].trim()) continue;
  const line = name + "=" + randomBytes(32).toString("base64url");
  content = match
    ? content.replace(expression, line)
    : content.trimEnd() + "\n" + line + "\n";
}
await writeFile(file, content, { mode: 0o600 });
console.log(
  "Assistant access password configured in .env; value is not printed. Start the independent agent before use.",
);
