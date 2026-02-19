import { defineEventHandler, getRouterParam, readBody } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { db } from "@/db";
import { swarmTaskNotebookPages } from "@/db/schema";

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

  const body = await readBody(event);
  const { notebookPageId } = body ?? {};

  if (!notebookPageId) {
    return new Response(JSON.stringify({ error: "notebookPageId required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  await db
    .insert(swarmTaskNotebookPages)
    .values({ taskId: id, notebookPageId })
    .onConflictDoNothing();

  return { ok: true };
});
