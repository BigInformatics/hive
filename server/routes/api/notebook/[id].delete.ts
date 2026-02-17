import { defineEventHandler, getRouterParam } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { db } from "@/db";
import { notebookPages } from "@/db/schema";
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
    return new Response(JSON.stringify({ error: "ID required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const [page] = await db
    .select({ id: notebookPages.id, createdBy: notebookPages.createdBy })
    .from(notebookPages)
    .where(eq(notebookPages.id, id))
    .limit(1);

  if (!page) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!auth.isAdmin && page.createdBy !== auth.identity) {
    return new Response(
      JSON.stringify({ error: "Only creator or admin can delete" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  await db.delete(notebookPages).where(eq(notebookPages.id, id));

  return { success: true };
});
