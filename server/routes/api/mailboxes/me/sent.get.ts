import { defineEventHandler, getQuery } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { mailboxMessages } from "@/db/schema";

export default defineEventHandler(async (event) => {
  const auth = authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const query = getQuery(event);
  const limit = Math.min(Number(query.limit) || 50, 100);

  const messages = await db
    .select()
    .from(mailboxMessages)
    .where(eq(mailboxMessages.sender, auth.identity))
    .orderBy(desc(mailboxMessages.createdAt))
    .limit(limit);

  return { messages };
});
