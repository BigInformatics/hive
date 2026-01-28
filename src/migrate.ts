// Database migration script
import { sql, close } from "./db/client";
import { readFileSync } from "fs";
import { join } from "path";

async function migrate() {
  console.log("[migrate] Running schema migration...");
  
  const schemaPath = join(import.meta.dir, "db", "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");
  
  // Split by semicolons and run each statement
  const statements = schema
    .split(";")
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith("--"));
  
  for (const stmt of statements) {
    try {
      await sql.unsafe(stmt);
      console.log(`[migrate] OK: ${stmt.slice(0, 60)}...`);
    } catch (err) {
      // Ignore "already exists" errors
      if (err instanceof Error && err.message.includes("already exists")) {
        console.log(`[migrate] SKIP (exists): ${stmt.slice(0, 60)}...`);
      } else {
        console.error(`[migrate] ERROR: ${stmt.slice(0, 60)}...`);
        throw err;
      }
    }
  }
  
  console.log("[migrate] Done!");
  await close();
}

migrate().catch(err => {
  console.error("[migrate] Failed:", err);
  process.exit(1);
});
