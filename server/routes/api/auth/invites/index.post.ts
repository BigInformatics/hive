import { defineEventHandler, readBody } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { db } from "@/db";
import { invites } from "@/db/schema";
import { randomBytes } from "node:crypto";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth?.isAdmin) {
    return new Response(JSON.stringify({ error: "Admin required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await readBody(event);
  const code = randomBytes(24).toString("hex");
  const webhookToken = randomBytes(24).toString("hex");
  const expiresIn = body?.expiresInHours ? Number(body.expiresInHours) : 72;

  const [row] = await db
    .insert(invites)
    .values({
      code,
      createdBy: auth.identity,
      identityHint: body?.identityHint || null,
      isAdmin: body?.isAdmin || false,
      maxUses: body?.maxUses || 1,
      expiresAt: new Date(Date.now() + expiresIn * 3600_000),
      webhookToken,
    })
    .returning();

  return {
    invite: row,
    webhookToken,
    onboardUrl: `https://messages.biginformatics.net/onboard?code=${code}`,
  };
});
