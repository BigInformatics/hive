import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { defineEventHandler, getRouterParam } from "h3";
import { db } from "@/db";
import { mailboxTokens } from "@/db/schema";
import { authenticateEvent, clearAuthCache } from "@/lib/auth";

/**
 * POST /api/auth/tokens/:id/rotate
 *
 * Rotates a token: revokes the old one and issues a new token
 * for the same identity with the same permissions.
 *
 * Requires admin auth OR the token being rotated must belong
 * to the authenticated identity (self-rotation).
 */
export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const id = getRouterParam(event, "id");
  if (!id) {
    return new Response(JSON.stringify({ error: "Missing id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Fetch the existing token
  const [existing] = await db
    .select()
    .from(mailboxTokens)
    .where(eq(mailboxTokens.id, Number(id)))
    .limit(1);

  if (!existing) {
    return new Response(JSON.stringify({ error: "Token not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (existing.revokedAt) {
    return new Response(JSON.stringify({ error: "Token already revoked" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Allow self-rotation or admin
  if (!auth.isAdmin && auth.identity !== existing.identity) {
    return new Response(
      JSON.stringify({ error: "Admin required or must own this token" }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Generate new token
  const newToken = randomBytes(32).toString("hex");

  // Revoke old token
  await db
    .update(mailboxTokens)
    .set({ revokedAt: new Date() })
    .where(eq(mailboxTokens.id, Number(id)));

  // Create new token with same identity
  const [newRow] = await db
    .insert(mailboxTokens)
    .values({
      token: newToken,
      identity: existing.identity,
      label: `Rotated from token #${id}`,
      createdBy: auth.identity,
      webhookUrl: existing.webhookUrl,
      webhookToken: newToken,
    })
    .returning();

  clearAuthCache();

  return {
    previousTokenId: Number(id),
    newToken: {
      id: newRow.id,
      identity: newRow.identity,
      token: newRow.token,
    },
    message:
      "Token rotated. Old token is now revoked. Update your configuration with the new token.",
  };
});
