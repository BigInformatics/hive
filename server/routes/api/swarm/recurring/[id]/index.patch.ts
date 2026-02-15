import { defineEventHandler, readBody, getRouterParam } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { updateRecurringTemplate } from "@/lib/recurring";

export default defineEventHandler(async (event) => {
  const auth = authenticateEvent(event);
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

  const body = await readBody(event);
  const template = await updateRecurringTemplate(id, {
    projectId: body.projectId,
    title: body.title,
    detail: body.detail,
    assigneeUserId: body.assigneeUserId,
    cronExpr: body.cronExpr,
    timezone: body.timezone,
    initialStatus: body.initialStatus,
    enabled: body.enabled,
  });

  if (!template) {
    return new Response(JSON.stringify({ error: "Template not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return template;
});
