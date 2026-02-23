import { createReadStream, existsSync } from "node:fs";
import { Readable } from "node:stream";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  defineEventHandler,
  getRouterParam,
  sendStream,
  setResponseHeader,
} from "h3";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { authenticateEvent } from "@/lib/auth";

const ATTACHMENT_DIR =
  process.env.ATTACHMENT_DIR || join(process.cwd(), "data", "attachments");

/**
 * GET /api/attachments/:id
 * Download/view an attachment by ID.
 */
export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response("Unauthorized", { status: 401 });
  }

  const id = getRouterParam(event, "id");
  if (!id) {
    return new Response("Not found", { status: 404 });
  }

  const [attachment] = await db
    .select()
    .from(attachments)
    .where(eq(attachments.id, id))
    .limit(1);

  if (!attachment) {
    return new Response("Not found", { status: 404 });
  }

  const filePath = join(ATTACHMENT_DIR, attachment.filename);
  if (!existsSync(filePath)) {
    return new Response("File missing from storage", { status: 404 });
  }

  setResponseHeader(event, "Content-Type", attachment.mimeType);
  setResponseHeader(
    event,
    "Content-Disposition",
    `inline; filename="${attachment.originalName.replace(/"/g, '\\"')}"`,
  );
  setResponseHeader(event, "Cache-Control", "private, max-age=3600");

  return sendStream(event, Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>);
});
