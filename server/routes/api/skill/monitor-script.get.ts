import { defineEventHandler } from "h3";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";

let cached: string | null = null;

export default defineEventHandler(() => {
  if (!cached) {
    // In production, CWD is /app and scripts/ is at /app/scripts/
    // In dev, it's relative to project root
    const candidates = [
      resolve("scripts/hive-sse-monitor.ts"),
      resolve(process.cwd(), "scripts/hive-sse-monitor.ts"),
      "/app/scripts/hive-sse-monitor.ts",
    ];

    for (const p of candidates) {
      try {
        cached = readFileSync(p, "utf-8");
        break;
      } catch {}
    }

    if (!cached) {
      return new Response("Monitor script not found", {
        status: 404,
        headers: { "Content-Type": "text/plain" },
      });
    }
  }

  return new Response(cached, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
});
