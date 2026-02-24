import { desc, eq } from "drizzle-orm";
import { defineEventHandler } from "h3";
import { db } from "@/db";
import { mailboxTokens, users } from "@/db/schema";
import { authenticateEvent } from "@/lib/auth";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth?.isAdmin) {
    return new Response(JSON.stringify({ error: "Admin required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rows = await db
    .select({
      id: mailboxTokens.id,
      identity: mailboxTokens.identity,
      isAdmin: users.isAdmin, // derived from users table
      label: mailboxTokens.label,
      createdBy: mailboxTokens.createdBy,
      createdAt: mailboxTokens.createdAt,
      lastUsedAt: mailboxTokens.lastUsedAt,
      revokedAt: mailboxTokens.revokedAt,
      webhookToken: mailboxTokens.webhookToken,
    })
    .from(mailboxTokens)
    .leftJoin(users, eq(mailboxTokens.identity, users.id))
    .orderBy(desc(mailboxTokens.createdAt))
    .limit(100);

  return { tokens: rows };
});
