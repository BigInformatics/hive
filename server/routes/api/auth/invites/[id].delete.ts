import { defineEventHandler, getRouterParam } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { db } from "@/db";
import { invites } from "@/db/schema";
import { eq } from "drizzle-orm";

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

  await db.delete(invites).where(eq(invites.id, Number(id)));
  return { ok: true };
});
