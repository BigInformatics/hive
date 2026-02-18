import { defineEventHandler } from "h3";
import { authenticateEvent } from "@/lib/auth";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth?.isAdmin) {
    return new Response(JSON.stringify({ error: "Admin only" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  return {
    PGHOST: process.env.PGHOST || "(unset)",
    HIVE_PGHOST: process.env.HIVE_PGHOST || "(unset)",
    PGUSER: process.env.PGUSER || "(unset)",
    PGDATABASE_TEAM: process.env.PGDATABASE_TEAM || "(unset)",
    PGDATABASE: process.env.PGDATABASE || "(unset)",
    PGPORT: process.env.PGPORT || "(unset)",
    NODE_ENV: process.env.NODE_ENV || "(unset)",
  };
});
