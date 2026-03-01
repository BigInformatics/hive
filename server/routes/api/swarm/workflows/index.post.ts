import { defineEventHandler, readBody } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { createWorkflow } from "@/lib/workflow";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = (await readBody<Record<string, any>>(event)) ?? {};
  if (!body?.title) {
    return new Response(JSON.stringify({ error: "title is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const wf = await createWorkflow({
    title: body.title,
    description: body.description,
    documentUrl: body.documentUrl,
    document: body.document,
    enabled: body.enabled !== undefined ? Boolean(body.enabled) : true,
    taggedUsers: Array.isArray(body.taggedUsers) ? body.taggedUsers : undefined,
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    reviewAt: body.reviewAt ? new Date(body.reviewAt) : undefined,
    createdBy: auth.identity,
  });

  return wf;
});
