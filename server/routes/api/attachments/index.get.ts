import { and, eq } from "drizzle-orm";
import { defineEventHandler, getQuery } from "h3";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { authenticateEvent } from "@/lib/auth";

/**
 * GET /api/attachments?entityType=task&entityId=xxx
 * List attachments for a given entity.
 */
export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const query = getQuery(event);
  const entityType = query.entityType as string;
  const entityId = query.entityId as string;

  if (!entityType || !entityId) {
    return new Response(
      JSON.stringify({
        error: "entityType and entityId query params required",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const rows = await db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.entityType, entityType),
        eq(attachments.entityId, entityId),
      ),
    )
    .orderBy(attachments.createdAt);

  return {
    attachments: rows.map((a) => ({
      id: a.id,
      entityType: a.entityType,
      entityId: a.entityId,
      originalName: a.originalName,
      mimeType: a.mimeType,
      size: a.size,
      url: `/api/attachments/${a.id}`,
      createdBy: a.createdBy,
      createdAt: a.createdAt,
    })),
  };
});
