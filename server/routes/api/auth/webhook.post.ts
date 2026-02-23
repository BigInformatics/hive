import { and, eq, isNull } from "drizzle-orm";
import { defineEventHandler, readBody } from "h3";
import { db } from "@/db";
import { mailboxTokens } from "@/db/schema";
import { authenticateEvent } from "@/lib/auth";
import { clearWebhookCache } from "@/lib/webhooks";

/**
 * POST /api/auth/webhook
 * Register or update webhook URL for the authenticated agent.
 * Body: { url: string | null, token?: string | null }
 *
 * - url: The webhook endpoint URL (set to null to clear)
 * - token: Optional override for webhook auth token (defaults to agent's own API token)
 */
export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await readBody<Record<string, any>>(event) ?? {};
  const url = body?.url ?? null;
  const token = body?.token ?? null;

  // Validate webhook URL if provided
  if (url) {
    const { validateWebhookUrl } = await import("@/lib/url-validation");
    const validation = validateWebhookUrl(url);
    if (!validation.valid) {
      return new Response(JSON.stringify({ error: validation.error }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Find the active token row for this identity
  const [row] = await db
    .select({ id: mailboxTokens.id, token: mailboxTokens.token })
    .from(mailboxTokens)
    .where(
      and(
        eq(mailboxTokens.identity, auth.identity),
        isNull(mailboxTokens.revokedAt),
      ),
    )
    .limit(1);

  if (!row) {
    return new Response(
      JSON.stringify({ error: "No token found for identity" }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Update webhook config — if no token override, use the agent's own API token
  await db
    .update(mailboxTokens)
    .set({
      webhookUrl: url,
      webhookToken: url ? token || row.token : null,
    })
    .where(eq(mailboxTokens.id, row.id));

  clearWebhookCache();

  return {
    ok: true,
    identity: auth.identity,
    webhookUrl: url,
    message: url ? "Webhook registered" : "Webhook cleared",
  };
});
