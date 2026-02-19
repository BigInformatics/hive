import { isNull } from "drizzle-orm";
import { defineEventHandler } from "h3";
import { db } from "@/db";
import { mailboxTokens } from "@/db/schema";
import { authenticateEvent } from "@/lib/auth";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Get identities from DB tokens (non-revoked)
  const dbTokens = await db
    .select({ identity: mailboxTokens.identity })
    .from(mailboxTokens)
    .where(isNull(mailboxTokens.revokedAt));

  const identities = new Set(dbTokens.map((t) => t.identity));

  // Also include env token identities
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("MAILBOX_TOKEN_")) {
      identities.add(key.replace("MAILBOX_TOKEN_", "").toLowerCase());
    }
  }

  // Remove the admin token key if it slipped in
  identities.delete("admin");

  return { users: [...identities].sort() };
});
