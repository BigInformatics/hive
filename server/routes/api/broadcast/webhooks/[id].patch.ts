import { eq } from "drizzle-orm";
import { defineEventHandler, getRouterParam, readBody } from "h3";
import { db } from "@/db";
import { broadcastWebhooks } from "@/db/schema";
import { authenticateEvent } from "@/lib/auth";

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
    return new Response(JSON.stringify({ error: "id required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = (await readBody<Record<string, any>>(event)) ?? {};
  const updates: Record<string, unknown> = {};
  if (body.title !== undefined) updates.title = body.title;
  if (body.appName !== undefined) updates.appName = body.appName;
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.forUsers !== undefined) updates.forUsers = body.forUsers;

  if (Object.keys(updates).length === 0) {
    return new Response(JSON.stringify({ error: "No fields to update" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const [row] = await db
    .update(broadcastWebhooks)
    .set(updates)
    .where(eq(broadcastWebhooks.id, Number(id)))
    .returning();

  if (!row) {
    return new Response(JSON.stringify({ error: "Webhook not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return row;
});
