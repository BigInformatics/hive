import { defineEventHandler, getRouterParam } from "h3";
import { and, eq } from "drizzle-orm";
import { authenticateEvent } from "@/lib/auth";
import { db } from "@/db";
import { swarmTaskComments } from "@/db/schema";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const commentId = getRouterParam(event, "commentId");
  if (!commentId) {
    return new Response(JSON.stringify({ error: "commentId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Only the comment author can delete their own comment
  const deleted = await db
    .delete(swarmTaskComments)
    .where(
      and(
        eq(swarmTaskComments.id, commentId),
        eq(swarmTaskComments.userId, auth.identity),
      ),
    )
    .returning();

  if (deleted.length === 0) {
    return new Response(
      JSON.stringify({ error: "Not found or not authorized" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  return { ok: true };
});
