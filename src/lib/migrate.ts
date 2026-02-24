/**
 * Auto-migration — runs pending SQL migrations from drizzle/ on server startup.
 *
 * Called once at module load time from the health route (same pattern as
 * startScheduler). Uses the raw postgres client for simplicity.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

let migrationsDone = false;

async function runMigrations() {
  const host = process.env.HIVE_PGHOST || process.env.PGHOST || "localhost";
  const port = Number(process.env.PGPORT || 5432);
  const user = process.env.PGUSER || "postgres";
  const password = process.env.PGPASSWORD || "";
  const database =
    process.env.PGDATABASE_TEAM || process.env.PGDATABASE || "postgres";

  const sql = postgres({ host, port, user, password, database, max: 1 });

  try {
    // Create tracking table on first run
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

    // Apply optional grants for the Docker container role (if it exists)
    // This avoids migrations failing in environments that don't have team_user.
    try {
      const role = await sql<{ exists: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'team_user') as exists
      `;
      if (role[0]?.exists) {
        await sql.unsafe("GRANT ALL ON swarm_projects TO team_user");
      }
    } catch (err) {
      console.warn("[migrate] Optional grants failed (non-fatal):", err);
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

/** Call once at module load time — idempotent, safe on every restart. */
export function startMigrations() {
  if (migrationsDone) return;
  migrationsDone = true;
  runMigrations().catch((err) =>
    console.error("[migrate] Migration error:", err),
  );
}
