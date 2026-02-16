import { defineEventHandler } from "h3";
import { db } from "@/db";
import { mailboxTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authenticateEvent } from "@/lib/auth";

/**
 * GET /api/auth/webhook
 * Check current webhook config for the authenticated agent.
 */
export default defineEventHandler(async (event) => {
  const identity = await authenticateEvent(event);
  if (!identity) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const [row] = await db
    .select({
      webhookUrl: mailboxTokens.webhookUrl,
    })
    .from(mailboxTokens)
    .where(eq(mailboxTokens.identity, identity))
    .limit(1);

  return {
    identity,
    webhookUrl: row?.webhookUrl || null,
    configured: !!row?.webhookUrl,
  };
});
