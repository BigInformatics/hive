import { defineEventHandler } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { db } from "@/db";
import { mailboxTokens } from "@/db/schema";
import { desc, isNull } from "drizzle-orm";

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
      isAdmin: mailboxTokens.isAdmin,
      label: mailboxTokens.label,
      createdBy: mailboxTokens.createdBy,
      createdAt: mailboxTokens.createdAt,
      lastUsedAt: mailboxTokens.lastUsedAt,
      revokedAt: mailboxTokens.revokedAt,
      webhookToken: mailboxTokens.webhookToken,
    })
    .from(mailboxTokens)
    .orderBy(desc(mailboxTokens.createdAt))
    .limit(100);

  return { tokens: rows };
});
