import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { defineEventHandler, getRouterParam } from "h3";
import { eq } from "drizzle-orm";
import { authenticateEvent } from "@/lib/auth";
import { db } from "@/db";
import { attachments } from "@/db/schema";

const ATTACHMENT_DIR =
  process.env.ATTACHMENT_DIR || join(process.cwd(), "data", "attachments");

/**
 * DELETE /api/attachments/:id
 * Delete an attachment. Creator or admin only.
 */
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
    return new Response(JSON.stringify({ error: "id required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const [attachment] = await db
    .select()
    .from(attachments)
    .where(eq(attachments.id, id))
    .limit(1);

  if (!attachment) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Only the creator or an admin can delete
  if (attachment.createdBy !== auth.identity && !auth.isAdmin) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Remove file from disk
  try {
    unlinkSync(join(ATTACHMENT_DIR, attachment.filename));
  } catch {
    // File may already be gone — that's fine
  }

  await db.delete(attachments).where(eq(attachments.id, id));

  return { deleted: true, id };
});
