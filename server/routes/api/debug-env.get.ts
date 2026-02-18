import { defineEventHandler } from "h3";
import { authenticateEvent } from "@/lib/auth";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Try a simple query on directory_entries
  let dbTest = "not tested";
  try {
    const { db } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    const result = await db.execute(sql`SELECT count(*) FROM directory_entries`);
    dbTest = JSON.stringify(result);
  } catch (e: any) {
    dbTest = `ERROR: ${e?.message ?? e}`;
  }

  return {
    dbTest,
    identity: auth.identity,
    isAdmin: auth.isAdmin,
    PGHOST: process.env.PGHOST || "(unset)",
    HIVE_PGHOST: process.env.HIVE_PGHOST || "(unset)",
    PGUSER: process.env.PGUSER || "(unset)",
    PGDATABASE_TEAM: process.env.PGDATABASE_TEAM || "(unset)",
    PGDATABASE: process.env.PGDATABASE || "(unset)",
    PGPORT: process.env.PGPORT || "(unset)",
    NODE_ENV: process.env.NODE_ENV || "(unset)",
  };
});
