import { eq } from "drizzle-orm";
import { defineEventHandler, getRouterParam } from "h3";
import { db } from "@/db";
import { mailboxTokens } from "@/db/schema";
import { authenticateEvent, clearAuthCache } from "@/lib/auth";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth?.isAdmin) {
    return new Response(JSON.stringify({ error: "Admin required" }), {
      status: 403,
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

  const [row] = await db
    .update(mailboxTokens)
    .set({ revokedAt: new Date() })
    .where(eq(mailboxTokens.id, Number(id)))
    .returning();

  clearAuthCache();

  return row || { error: "Token not found" };
});
