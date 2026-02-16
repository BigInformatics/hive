import { defineEventHandler } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { db } from "@/db";
import { mailboxTokens } from "@/db/schema";
import { eq, isNull, and } from "drizzle-orm";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
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
    .where(
      and(
        eq(mailboxTokens.identity, auth.identity),
        isNull(mailboxTokens.revokedAt),
      ),
    )
    .limit(1);

  return {
    identity: auth.identity,
    webhookUrl: row?.webhookUrl || null,
    configured: !!row?.webhookUrl,
  };
});
