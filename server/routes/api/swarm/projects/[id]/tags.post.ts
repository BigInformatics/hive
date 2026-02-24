import { and, eq } from "drizzle-orm";
import { defineEventHandler, getRouterParam, readBody } from "h3";
import { db } from "@/db";
import { contentProjectTags, swarmProjects } from "@/db/schema";
import { authenticateEvent } from "@/lib/auth";

/**
 * POST /api/swarm/projects/:id/tags
 * Tag content with a project.
 * Body: { contentType: 'message'|'chat_message'|'notebook_page'|'directory_link', contentId: string }
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

  const validTypes = [
    "message",
    "chat_message",
    "notebook_page",
    "directory_link",
  ];
  if (!contentType || !validTypes.includes(contentType)) {
    return new Response(
      JSON.stringify({
        error: `contentType must be one of: ${validTypes.join(", ")}`,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!contentId) {
    return new Response(JSON.stringify({ error: "contentId required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verify project exists
  const [project] = await db
    .select({ id: swarmProjects.id })
    .from(swarmProjects)
    .where(eq(swarmProjects.id, projectId))
    .limit(1);

  if (!project) {
    return new Response(JSON.stringify({ error: "Project not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Check for existing tag (upsert)
  const [existing] = await db
    .select({ id: contentProjectTags.id })
    .from(contentProjectTags)
    .where(
      and(
        eq(contentProjectTags.projectId, projectId),
        eq(contentProjectTags.contentType, contentType),
        eq(contentProjectTags.contentId, String(contentId)),
      ),
    )
    .limit(1);

  if (existing) {
    return { id: existing.id, message: "Already tagged" };
  }

  const [tag] = await db
    .insert(contentProjectTags)
    .values({
      projectId,
      contentType,
      contentId: String(contentId),
      taggedBy: auth.identity,
    })
    .returning();

  return tag;
});
