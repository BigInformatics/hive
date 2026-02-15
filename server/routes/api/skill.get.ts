import { defineEventHandler } from "h3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let skillDoc: string;
try {
  skillDoc = readFileSync(resolve(process.cwd(), "SKILL.md"), "utf-8");
} catch {
  skillDoc = "# Hive API\n\nSKILL.md not found. See https://messages.biginformatics.net for the UI.";
}

export default defineEventHandler(() => {
  return new Response(skillDoc, {
    headers: { "Content-Type": "text/plain" },
  });
});
