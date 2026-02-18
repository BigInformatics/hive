import { defineEventHandler, getRouterParam } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { db } from "@/db";
import { directoryEntries } from "@/db/schema";
import { eq } from "drizzle-orm";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rawId = getRouterParam(event, "id");
  const id = parseInt(rawId ?? "");
  if (isNaN(id)) {
    return new Response(JSON.stringify({ error: "Invalid id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const [entry] = await db
    .select()
    .from(directoryEntries)
    .where(eq(directoryEntries.id, id))
    .limit(1);

  if (!entry) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!auth.isAdmin && entry.createdBy !== auth.identity) {
    return new Response(
      JSON.stringify({ error: "Only creator or admin can delete" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  await db.delete(directoryEntries).where(eq(directoryEntries.id, id));

  return { success: true, id };
});
