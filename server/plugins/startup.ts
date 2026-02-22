/**
 * Startup plugin — runs once when the Nitro server initialises.
 *
 * Applies any pending SQL migrations from the drizzle/ folder.
 * Migrations are tracked in _hive_migrations (created on first run).
 *
 * Uses the raw postgres client so there's no ORM dependency at startup.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { definePlugin } from "nitro";
import postgres from "postgres";

async function runMigrations() {
  const host = process.env.HIVE_PGHOST || process.env.PGHOST || "localhost";
  const port = Number(process.env.PGPORT || 5432);
  const user = process.env.PGUSER || "postgres";
  const password = process.env.PGPASSWORD || "";
  const database =
    process.env.PGDATABASE_TEAM || process.env.PGDATABASE || "postgres";

  const sql = postgres({ host, port, user, password, database, max: 1 });

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS _hive_migrations (
        id         serial PRIMARY KEY,
        filename   text NOT NULL UNIQUE,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    const migrationsDir = join(process.cwd(), "drizzle");
    let files: string[];

    try {
      const entries = await readdir(migrationsDir);
      files = entries
        .filter((f) => f.endsWith(".sql") && !f.startsWith("_"))
        .sort();
    } catch {
      console.warn(
        `[migrate] drizzle/ not found at ${migrationsDir} — skipping`,
      );
      return;
    }

    const rows = await sql<
      { filename: string }[]
    >`SELECT filename FROM _hive_migrations`;
    const applied = new Set(rows.map((r) => r.filename));

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) continue;

      const raw = await readFile(join(migrationsDir, file), "utf8");
      const statements = raw
        .split(";")
        .map((s) => s.replace(/--[^\n]*/g, "").trim())
        .filter(Boolean);

      for (const stmt of statements) {
        await sql.unsafe(stmt);
      }

      await sql`INSERT INTO _hive_migrations (filename) VALUES (${file})`;
      console.log(`[migrate] Applied: ${file}`);
      ran++;
    }

    if (ran === 0) {
      console.log(
        `[migrate] Up to date (${files.length} migration(s) already applied)`,
      );
    } else {
      console.log(`[migrate] Applied ${ran} migration(s)`);
    }
  } finally {
    await sql.end();
  }
}

export default definePlugin(async () => {
  try {
    await runMigrations();
  } catch (err) {
    console.error("[migrate] Migration error — server starting anyway:", err);
  }
});
