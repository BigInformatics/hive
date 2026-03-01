import { defineEventHandler, getRouterParam } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { detachWorkflow } from "@/lib/workflow";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const taskId = getRouterParam(event, "id");
  const workflowId = getRouterParam(event, "wid");
  if (!taskId || !workflowId) {
    return new Response(JSON.stringify({ error: "Missing id or wid" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  await detachWorkflow(taskId, workflowId);
  return { ok: true };
});
