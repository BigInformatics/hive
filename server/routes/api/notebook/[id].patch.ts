import { eq, sql } from "drizzle-orm";
import { defineEventHandler, getRouterParam, readBody } from "h3";
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

  const isOwnerOrAdmin = auth.isAdmin || page.createdBy === auth.identity;

  // Archived pages: no edits allowed (except unarchiving by owner/admin)
  if (page.archivedAt) {
    return new Response(JSON.stringify({ error: "Page is archived" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Locked pages: only owner/admin can edit
  if (page.locked && !isOwnerOrAdmin) {
    return new Response(JSON.stringify({ error: "Page is locked" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await readBody(event);
  const { title, content, taggedUsers, tags, locked, expiresAt, reviewAt } =
    body ?? {};

  // Only owner/admin can change lock or access settings
  if ((locked !== undefined || taggedUsers !== undefined) && !isOwnerOrAdmin) {
    return new Response(
      JSON.stringify({
        error: "Only creator or admin can change access settings",
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  const updates: Record<string, unknown> = { updatedAt: sql`now()` };
  if (title !== undefined) updates.title = String(title).slice(0, 255);
  if (content !== undefined) updates.content = String(content);
  if (taggedUsers !== undefined) {
    updates.taggedUsers =
      Array.isArray(taggedUsers) && taggedUsers.length > 0
        ? taggedUsers.map(String)
        : null;
  }
  if (tags !== undefined) {
    updates.tags =
      Array.isArray(tags) && tags.length > 0 ? tags.map(String) : null;
  }
  if (expiresAt !== undefined) {
    updates.expiresAt = expiresAt ? new Date(expiresAt) : null;
  }
  if (reviewAt !== undefined) {
    updates.reviewAt = reviewAt ? new Date(reviewAt) : null;
  }
  if (locked !== undefined) {
    updates.locked = !!locked;
    updates.lockedBy = locked ? auth.identity : null;
  }

  const [updated] = await db
    .update(notebookPages)
    .set(updates)
    .where(eq(notebookPages.id, id))
    .returning();

  return { page: updated };
});
