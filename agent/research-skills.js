import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// Fixed package registry: model/user input can select a name, never a file path.
const names = [
  "twstock-evidence",
  "twstock-technical",
  "twstock-compare",
  "twstock-position",
];
export async function researchSkills() {
  return Promise.all(
    names.map(async (name) => {
      const content = await readFile(
        new URL(`./skills/${name}/SKILL.md`, import.meta.url),
        "utf8",
      );
      const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1];
      const actual = /^name:\s*([a-z0-9-]+)\s*$/m.exec(front || "")?.[1];
      const description = /^description:\s*(.+)$/m
        .exec(front || "")?.[1]
        ?.trim();
      if (actual !== name || !description || content.length > 16000)
        throw Error("研究技能格式不符");
      return {
        name,
        description,
        content,
        version: createHash("sha256")
          .update(content)
          .digest("hex")
          .slice(0, 16),
      };
    }),
  );
}
export async function skillCatalogue() {
  return (await researchSkills()).map(({ content, ...meta }) => meta);
}
export async function readResearchSkill(name) {
  if (!names.includes(name))
    throw Error("找不到此研究技能，請使用提供的技能名稱");
  return (await researchSkills()).find((s) => s.name === name);
}
