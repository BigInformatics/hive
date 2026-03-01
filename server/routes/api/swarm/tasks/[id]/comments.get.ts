import { defineEventHandler, getRouterParam } from "h3";
import { asc, eq } from "drizzle-orm";
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

  const taskId = getRouterParam(event, "id");
  if (!taskId) {
    return new Response(JSON.stringify({ error: "id is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const comments = await db
    .select()
    .from(swarmTaskComments)
    .where(eq(swarmTaskComments.taskId, taskId))
    .orderBy(asc(swarmTaskComments.createdAt));

  return { comments };
});
