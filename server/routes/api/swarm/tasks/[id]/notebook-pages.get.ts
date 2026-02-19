import { defineEventHandler, getRouterParam } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { db } from "@/db";
import { swarmTaskNotebookPages, notebookPages } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

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

  // Apply notebook visibility rules: admins see all, others see only
  // pages where taggedUsers is null/empty OR contains their identity OR they created it
  const visibilityFilter = auth.isAdmin
    ? eq(swarmTaskNotebookPages.taskId, id)
    : sql`${swarmTaskNotebookPages.taskId} = ${id} AND (
        ${notebookPages.taggedUsers} IS NULL
        OR jsonb_array_length(${notebookPages.taggedUsers}) = 0
        OR ${notebookPages.taggedUsers} @> ${sql.raw(`'["${auth.identity}"]'::jsonb`)}
        OR ${notebookPages.createdBy} = ${auth.identity}
      )`;

  const links = await db
    .select({
      taskId: swarmTaskNotebookPages.taskId,
      notebookPageId: swarmTaskNotebookPages.notebookPageId,
      createdAt: swarmTaskNotebookPages.createdAt,
      pageTitle: notebookPages.title,
      pageCreatedBy: notebookPages.createdBy,
      pageUpdatedAt: notebookPages.updatedAt,
    })
    .from(swarmTaskNotebookPages)
    .innerJoin(notebookPages, eq(swarmTaskNotebookPages.notebookPageId, notebookPages.id))
    .where(visibilityFilter);

  return { pages: links };
});
