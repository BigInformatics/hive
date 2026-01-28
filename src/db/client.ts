// Database client using Bun's native postgres (bun:sql)
import { SQL } from "bun";

// Build connection string from env vars
function getConnectionUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  
  const host = process.env.PGHOST || "localhost";
  const port = process.env.PGPORT || "5432";
  const user = process.env.PGUSER || "postgres";
  const password = process.env.PGPASSWORD || "";
  const database = process.env.PGDATABASE_TEAM || process.env.PGDATABASE || "postgres";
  
  return `postgres://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

export const sql = new SQL(getConnectionUrl());

export async function healthCheck(): Promise<boolean> {
  try {
    const result = await sql`SELECT 1 as ok`;
    return result.length > 0;
  } catch (err) {
    console.error("[db] Health check failed:", err);
    return false;
  }
}

export async function close() {
  // Bun SQL auto-closes, but we can explicitly end
  await sql.close();
}
