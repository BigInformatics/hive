import { defineEventHandler, getQuery } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { db } from "@/db";
import { directoryEntries } from "@/db/schema";
import { and, desc, ilike, or, sql } from "drizzle-orm";

export default defineEventHandler(async (event) => {
  try {
    const auth = await authenticateEvent(event);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const query = getQuery(event);
    const q = (query.q as string | undefined)?.trim() ?? "";
    const limit = Math.min(parseInt((query.limit as string) || "50") || 50, 100);
    const offset = parseInt((query.offset as string) || "0") || 0;

    const conditions: any[] = [];

    // Visibility: admins see all; others see public or tagged-for-them
    if (!auth.isAdmin) {
      conditions.push(
        or(
          sql`${directoryEntries.taggedUsers} IS NULL`,
          sql`${directoryEntries.taggedUsers} = '[]'::jsonb`,
          sql`${directoryEntries.taggedUsers} @> ${JSON.stringify([auth.identity])}::jsonb`,
          sql`${directoryEntries.createdBy} = ${auth.identity}`,
        ),
      );
    }

    if (q) {
      conditions.push(
        or(
          ilike(directoryEntries.title, `%${q}%`),
          sql`${directoryEntries.description} ILIKE ${"%" + q + "%"}`,
        ),
      );
    }

    const entries = await db
      .select()
      .from(directoryEntries)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(directoryEntries.createdAt))
      .limit(limit)
      .offset(offset);

    return entries;
  } catch (err: any) {
    console.error("[directory:list]", err);
    return new Response(
      JSON.stringify({ error: err?.message ?? "Unknown error", stack: err?.stack }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
