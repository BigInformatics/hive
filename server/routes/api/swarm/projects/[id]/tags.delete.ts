import { and, eq } from "drizzle-orm";
import { defineEventHandler, getRouterParam, readBody } from "h3";
import { db } from "@/db";
import { contentProjectTags } from "@/db/schema";
import { authenticateEvent } from "@/lib/auth";

/**
 * DELETE /api/swarm/projects/:id/tags
 * Remove a tag from content.
 * Body: { contentType, contentId }
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

  const body = (await readBody<Record<string, any>>(event)) ?? {};
  const { contentType, contentId } = body || {};

  if (!contentType || !contentId) {
    return new Response(
      JSON.stringify({ error: "contentType and contentId required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const result = await db
    .delete(contentProjectTags)
    .where(
      and(
        eq(contentProjectTags.projectId, projectId),
        eq(contentProjectTags.contentType, contentType),
        eq(contentProjectTags.contentId, String(contentId)),
      ),
    )
    .returning({ id: contentProjectTags.id });

  if (result.length === 0) {
    return new Response(JSON.stringify({ error: "Tag not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return { deleted: true };
});
