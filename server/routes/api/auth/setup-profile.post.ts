import { eq } from "drizzle-orm";
import { defineEventHandler, readBody } from "h3";
import { db } from "@/db";
import { users } from "@/db/schema";
import { authenticateEvent } from "@/lib/auth";

/**
 * POST /api/auth/setup-profile
 *
 * First-run display name setup. Allows the authenticated user to set their
 * own display name. No admin required — any authenticated user can call this
 * to set their own name (identity comes from the auth token, not the body).
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
  const displayName = body?.displayName?.trim();

  if (!displayName || displayName.length < 1 || displayName.length > 100) {
    return new Response(
      JSON.stringify({ error: "displayName must be 1–100 characters" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const [updated] = await db
    .update(users)
    .set({ displayName, updatedAt: new Date() })
    .where(eq(users.id, auth.identity))
    .returning();

  if (!updated) {
    return new Response(JSON.stringify({ error: "User not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return { identity: updated.id, displayName: updated.displayName };
});
