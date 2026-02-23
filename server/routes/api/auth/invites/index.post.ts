import { randomBytes } from "node:crypto";
import { defineEventHandler, readBody } from "h3";
import { db } from "@/db";
import { invites } from "@/db/schema";
import { authenticateEvent } from "@/lib/auth";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth?.isAdmin) {
    return new Response(JSON.stringify({ error: "Admin required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await readBody<Record<string, any>>(event) ?? {};
  const code = randomBytes(24).toString("hex");
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
    })
    .returning();

  return {
    invite: row,
    onboardUrl: `${process.env.HIVE_BASE_URL || "http://localhost:3000"}/onboard?code=${code}`,
  };
});
