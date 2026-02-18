import { defineEventHandler, readBody } from "h3";
import { db } from "@/db";
import { invites, mailboxTokens } from "@/db/schema";
import { eq, and, or, isNull, gt } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { clearAuthCache, registerMailbox } from "@/lib/auth";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body?.code || !body?.identity) {
    return new Response(
      JSON.stringify({ error: "code and identity are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const identity = String(body.identity).toLowerCase().trim();
  if (!/^[a-z][a-z0-9_-]*$/.test(identity) || identity.length > 50) {
    return new Response(
      JSON.stringify({ error: "Identity must be lowercase alphanumeric (start with letter, max 50 chars)" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Find valid invite
  const [invite] = await db
    .select()
    .from(invites)
    .where(
      and(
        eq(invites.code, body.code),
        or(isNull(invites.expiresAt), gt(invites.expiresAt, new Date())),
      ),
    )
    .limit(1);

  if (!invite) {
    return new Response(
      JSON.stringify({ error: "Invalid or expired invite code" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  if (invite.useCount >= invite.maxUses) {
    return new Response(
      JSON.stringify({ error: "Invite has been fully used" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  // If invite has an identity hint, enforce it
  if (invite.identityHint && invite.identityHint !== identity) {
    return new Response(
      JSON.stringify({ error: `This invite is for identity "${invite.identityHint}"` }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Generate token
  const token = randomBytes(32).toString("hex");
  const label = body.label || `Onboarded via invite`;

  // Create the token — use same token for API auth and webhook delivery
  const [tokenRow] = await db
    .insert(mailboxTokens)
    .values({
      token,
      identity,
      isAdmin: invite.isAdmin,
      label,
      createdBy: invite.createdBy,
      webhookToken: token,
    })
    .returning();

  // Increment invite use count
  await db
    .update(invites)
    .set({ useCount: invite.useCount + 1 })
    .where(eq(invites.id, invite.id));

  // Register the mailbox and clear auth cache
  registerMailbox(identity);
  clearAuthCache();

  return {
    identity: tokenRow.identity,
    token: tokenRow.token,
    isAdmin: tokenRow.isAdmin,
    message: `Welcome to Hive, ${identity}! Save your token — it won't be shown again. Use the same token for both API auth (Authorization: Bearer <token>) and gateway webhook config (hooks.token).`,
  };
});
