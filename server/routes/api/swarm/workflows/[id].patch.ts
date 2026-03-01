import { defineEventHandler, getRouterParam, readBody } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { getWorkflow, updateWorkflow } from "@/lib/workflow";

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
    return new Response(JSON.stringify({ error: "id is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Confirm it exists and caller can see it
  const existing = await getWorkflow(id, auth.identity);
  if (!existing) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = (await readBody<Record<string, any>>(event)) ?? {};
  const patch: Record<string, any> = {};

  if (body.title !== undefined) patch.title = body.title;
  if (body.description !== undefined) patch.description = body.description;
  if (body.documentUrl !== undefined) patch.documentUrl = body.documentUrl;
  if (body.document !== undefined) patch.document = body.document;
  if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
  if (body.taggedUsers !== undefined)
    patch.taggedUsers = Array.isArray(body.taggedUsers)
      ? body.taggedUsers
      : null;
  if (body.expiresAt !== undefined)
    patch.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  if (body.reviewAt !== undefined)
    patch.reviewAt = body.reviewAt ? new Date(body.reviewAt) : null;

  const updated = await updateWorkflow(id, patch);
  return updated;
});
