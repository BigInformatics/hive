import { eq } from "drizzle-orm";
import { defineEventHandler, getRouterParam } from "h3";
import { db } from "@/db";
import { notebookPages } from "@/db/schema";
import { authenticateEvent } from "@/lib/auth";

function canAccess(
  page: { createdBy: string; taggedUsers: string[] | null },
  identity: string,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true;
  if (page.createdBy === identity) return true;
  if (!page.taggedUsers || page.taggedUsers.length === 0) return true;
  return page.taggedUsers.includes(identity);
}

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
    .select()
    .from(notebookPages)
    .where(eq(notebookPages.id, id))
    .limit(1);

  if (!page) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!canAccess(page, auth.identity, auth.isAdmin)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  return { page };
});
