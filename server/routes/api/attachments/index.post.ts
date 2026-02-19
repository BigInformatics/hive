import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { defineEventHandler, readMultipartFormData } from "h3";
import { db } from "@/db";
import { attachments, notebookPages, swarmTasks } from "@/db/schema";
import { authenticateEvent } from "@/lib/auth";

const ATTACHMENT_DIR =
  process.env.ATTACHMENT_DIR || join(process.cwd(), "data", "attachments");
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_TYPES = new Set([
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  // PDF
  "application/pdf",
  // Text-based
  "application/json",
  "text/yaml",
  "application/x-yaml",
  "text/x-yaml",
  "text/markdown",
  "text/plain",
  "application/octet-stream", // fallback for excalidraw etc
]);

// Also allow by extension for text-based files that may come with generic mime
const ALLOWED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".svg",
  ".pdf",
  ".json",
  ".yaml",
  ".yml",
  ".md",
  ".txt",
  ".excalidraw",
]);

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

/**
 * POST /api/attachments
 * Upload a file attachment to a task or notebook page.
 * Multipart form: file (the file), entityType ('task' | 'notebook_page'), entityId (uuid/id)
 */
export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parts = await readMultipartFormData(event);
  if (!parts) {
    return new Response(
      JSON.stringify({ error: "Multipart form data required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const file = parts.find((p) => p.name === "file");
  const entityTypePart = parts.find((p) => p.name === "entityType");
  const entityIdPart = parts.find((p) => p.name === "entityId");

  const entityType = entityTypePart?.data?.toString();
  const entityId = entityIdPart?.data?.toString();

  if (!entityType || !entityId) {
    return new Response(
      JSON.stringify({ error: "entityType and entityId required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (entityType !== "task" && entityType !== "notebook_page") {
    return new Response(
      JSON.stringify({
        error: "entityType must be 'task' or 'notebook_page'",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!file || !file.data) {
    return new Response(JSON.stringify({ error: "No file provided" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (file.data.length > MAX_SIZE) {
    return new Response(
      JSON.stringify({ error: "File too large (max 10MB)" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const originalName = file.filename || "unnamed";
  const ext = getExtension(originalName);
  const mimeType = file.type || "application/octet-stream";

  if (!ALLOWED_TYPES.has(mimeType) && !ALLOWED_EXTENSIONS.has(ext)) {
    return new Response(JSON.stringify({ error: "File type not allowed" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verify the entity exists
  if (entityType === "task") {
    const [task] = await db
      .select({ id: swarmTasks.id })
      .from(swarmTasks)
      .where(eq(swarmTasks.id, entityId))
      .limit(1);
    if (!task) {
      return new Response(JSON.stringify({ error: "Task not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
  } else {
    const [page] = await db
      .select({ id: notebookPages.id })
      .from(notebookPages)
      .where(eq(notebookPages.id, entityId))
      .limit(1);
    if (!page) {
      return new Response(
        JSON.stringify({ error: "Notebook page not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  const storedFilename = `${crypto.randomUUID()}${ext}`;

  mkdirSync(ATTACHMENT_DIR, { recursive: true });
  writeFileSync(join(ATTACHMENT_DIR, storedFilename), file.data);

  const [attachment] = await db
    .insert(attachments)
    .values({
      entityType,
      entityId,
      filename: storedFilename,
      originalName,
      mimeType,
      size: file.data.length,
      createdBy: auth.identity,
    })
    .returning();

  return {
    id: attachment.id,
    entityType: attachment.entityType,
    entityId: attachment.entityId,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    size: attachment.size,
    url: `/api/attachments/${attachment.id}`,
    createdBy: attachment.createdBy,
    createdAt: attachment.createdAt,
  };
});
