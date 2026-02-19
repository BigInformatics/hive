import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineEventHandler } from "h3";

let cached: string | null = null;

function findScript(): string | null {
  const candidates = [
    resolve("scripts/hive-sse-monitor.ts"),
    resolve(process.cwd(), "scripts/hive-sse-monitor.ts"),
    "/app/scripts/hive-sse-monitor.ts",
    join(process.cwd(), "..", "scripts", "hive-sse-monitor.ts"),
  ];

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return readFileSync(p, "utf-8");
      } catch {}
    }
  }
  return null;
}

export default defineEventHandler(() => {
  if (!cached) {
    cached = findScript();
  }

  if (!cached) {
    return new Response(
      "Monitor script not found. Download from: https://github.com/BigInformatics/hive/blob/main/scripts/hive-sse-monitor.ts",
      { status: 404, headers: { "Content-Type": "text/plain" } },
    );
  }

  return new Response(cached, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
});
