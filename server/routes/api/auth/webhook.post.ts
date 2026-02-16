import { defineEventHandler, readBody } from "h3";
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

  const body = await readBody(event);
  const url = body?.url?.trim() || null;
  const token = body?.token?.trim() || null;

  // Allow clearing webhook by sending null/empty
  if (url && !token) {
    return new Response(
      JSON.stringify({ error: "token is required when setting a webhook url" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Update the DB token row for this identity
  const result = await db
    .update(mailboxTokens)
    .set({
      webhookUrl: url,
      webhookToken: token,
    })
    .where(
      and(
        eq(mailboxTokens.identity, auth.identity),
        isNull(mailboxTokens.revokedAt),
      ),
    )
    .returning({ id: mailboxTokens.id });

  if (result.length === 0) {
    // Agent might be using env var auth — no DB row to update
    return new Response(
      JSON.stringify({
        error: "No DB token found for your identity. Webhook config requires a DB-registered token (via invite onboarding).",
      }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  // Clear the webhook cache so changes take effect immediately
  try {
    const { clearWebhookCache } = await import("@/lib/webhooks");
    clearWebhookCache();
  } catch {}

  return {
    ok: true,
    identity: auth.identity,
    webhookUrl: url,
    message: url
      ? "Webhook registered. You will receive POST notifications for chat messages."
      : "Webhook cleared.",
  };
});
