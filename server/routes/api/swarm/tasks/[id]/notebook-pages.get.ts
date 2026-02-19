import { defineEventHandler, getRouterParam } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { db } from "@/db";
import { swarmTaskNotebookPages, notebookPages } from "@/db/schema";
import { eq } from "drizzle-orm";

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
    .where(eq(swarmTaskNotebookPages.taskId, id));

  return { pages: links };
});
