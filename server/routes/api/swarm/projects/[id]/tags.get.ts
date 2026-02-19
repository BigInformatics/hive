import { and, eq } from "drizzle-orm";
import { defineEventHandler, getQuery, getRouterParam } from "h3";
import { db } from "@/db";
import { contentProjectTags } from "@/db/schema";
import { authenticateEvent } from "@/lib/auth";

/**
 * GET /api/swarm/projects/:id/tags?contentType=notebook_page
 * List all tags for a project, optionally filtered by contentType.
 */
export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const projectId = getRouterParam(event, "id");
  if (!projectId) {
    return new Response(JSON.stringify({ error: "Project id required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const query = getQuery(event);
  const contentType = query.contentType as string | undefined;

  const conditions = [eq(contentProjectTags.projectId, projectId)];
  if (contentType) {
    conditions.push(eq(contentProjectTags.contentType, contentType));
  }

  const tags = await db
    .select()
    .from(contentProjectTags)
    .where(and(...conditions))
    .orderBy(contentProjectTags.taggedAt);

  return { tags };
});
