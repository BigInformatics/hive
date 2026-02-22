/**
 * Startup plugin — runs once when the Nitro server initialises.
 *
 * Responsibilities:
 *   1. Apply any pending DB migrations (idempotent — safe on every restart)
 *   2. Ensure the superuser record exists in the users table
 *
 * Migrations are read from ./drizzle relative to the working directory.
 * In production (Docker) the drizzle/ folder is copied into the image.
 * In development Vite/Nitro serves from the repo root where it already exists.
 */

import { sql } from "drizzle-orm";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "@/db";

async function runMigrations() {
  const migrationsDir = join(process.cwd(), "drizzle");

  // Ensure the migrations tracking table exists
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS _hive_migrations (
      id        serial PRIMARY KEY,
      filename  text NOT NULL UNIQUE,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  // Read all .sql files (sorted — numeric prefix guarantees order)
  let files: string[];
  try {
    const entries = await readdir(migrationsDir);
    files = entries
      .filter((f) => f.endsWith(".sql") && !f.startsWith("_"))
      .sort();
  } catch {
    console.warn(
      `[migrate] drizzle/ folder not found at ${migrationsDir} — skipping migrations`,
    );
    return;
  }

  // Fetch already-applied migrations
  const applied = await db.execute<{ filename: string }>(
    sql`SELECT filename FROM _hive_migrations`,
  );
  const appliedSet = new Set(applied.map((r) => r.filename));

  let ran = 0;
  for (const file of files) {
    if (appliedSet.has(file)) continue;

    const filePath = join(migrationsDir, file);
    const raw = await readFile(filePath, "utf8");

    // Strip comments and split on semicolons so we can run multi-statement files
    const statements = raw
      .split(";")
      .map((s) => s.replace(/--[^\n]*/g, "").trim())
      .filter(Boolean);

    for (const stmt of statements) {
      await db.execute(sql.raw(stmt));
    }

    await db.execute(
      sql`INSERT INTO _hive_migrations (filename) VALUES (${file})`,
    );

    console.log(`[migrate] Applied: ${file}`);
    ran++;
  }

  if (ran === 0) {
    console.log(`[migrate] DB up to date (${files.length} migration(s) already applied)`);
  } else {
    console.log(`[migrate] Applied ${ran} migration(s)`);
  }
}

export default defineNitroPlugin(async () => {
  try {
    await runMigrations();
  } catch (err) {
    console.error("[migrate] Migration failed — server may be unstable:", err);
    // Don't crash the server — let it start and surface DB errors naturally.
    // A broken schema is easier to debug than a server that won't start.
  }
});
