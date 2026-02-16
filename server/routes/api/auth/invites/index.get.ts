import { defineEventHandler } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { db } from "@/db";
import { invites } from "@/db/schema";
import { desc } from "drizzle-orm";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth?.isAdmin) {
    return new Response(JSON.stringify({ error: "Admin required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rows = await db
    .select()
    .from(invites)
    .orderBy(desc(invites.createdAt))
    .limit(50);

  return { invites: rows };
});
