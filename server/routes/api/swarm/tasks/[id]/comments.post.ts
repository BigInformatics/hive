import { defineEventHandler, getRouterParam, readBody } from "h3";
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

  const body = (await readBody<Record<string, any>>(event)) ?? {};
  if (!body.body?.trim()) {
    return new Response(JSON.stringify({ error: "body is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const validSentiments = ["wait", "proceed", null, undefined];
  if (body.sentiment !== undefined && !validSentiments.includes(body.sentiment)) {
    return new Response(
      JSON.stringify({ error: "sentiment must be 'wait', 'proceed', or omitted" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const [comment] = await db
    .insert(swarmTaskComments)
    .values({
      taskId,
      userId: auth.identity,
      body: body.body.trim(),
      sentiment: body.sentiment ?? null,
    })
    .returning();

  return comment;
});
