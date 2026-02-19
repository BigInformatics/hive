import { and, desc, ilike, isNull, or, sql } from "drizzle-orm";
import { defineEventHandler, getQuery } from "h3";
import { db } from "@/db";
import { notebookPages } from "@/db/schema";
import { authenticateEvent } from "@/lib/auth";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const query = getQuery(event);
  const q = (query.q as string | undefined)?.trim() ?? "";
  const limit = Math.min(
    parseInt((query.limit as string) || "50", 10) || 50,
    100,
  );
  const offset = parseInt((query.offset as string) || "0", 10) || 0;

  const conditions: any[] = [isNull(notebookPages.archivedAt)];

  if (!auth.isAdmin) {
    conditions.push(
      or(
        sql`${notebookPages.taggedUsers} IS NULL`,
        sql`${notebookPages.taggedUsers} = '[]'::jsonb`,
        sql`${notebookPages.taggedUsers} @> ${sql`${JSON.stringify([auth.identity])}::jsonb`}`,
        sql`${notebookPages.createdBy} = ${auth.identity}`,
      ),
    );
  }

  if (q) {
    conditions.push(
      or(
        ilike(notebookPages.title, `%${q}%`),
        ilike(notebookPages.content, `%${q}%`),
      ),
    );
  }

  const pages = await db
    .select({
      id: notebookPages.id,
      title: notebookPages.title,
      createdBy: notebookPages.createdBy,
      taggedUsers: notebookPages.taggedUsers,
      tags: notebookPages.tags,
      locked: notebookPages.locked,
      lockedBy: notebookPages.lockedBy,
      expiresAt: notebookPages.expiresAt,
      reviewAt: notebookPages.reviewAt,
      createdAt: notebookPages.createdAt,
      updatedAt: notebookPages.updatedAt,
    })
    .from(notebookPages)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(notebookPages.updatedAt))
    .limit(limit)
    .offset(offset);

  return { pages };
});
