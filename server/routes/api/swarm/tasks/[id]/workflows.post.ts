import { defineEventHandler, getRouterParam, readBody } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { attachWorkflow, getWorkflow } from "@/lib/workflow";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const taskId = getRouterParam(event, "id");
  if (!taskId) {
    return new Response(JSON.stringify({ error: "id is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = (await readBody<{ workflowId: string }>(event)) ?? {};
  if (!body?.workflowId) {
    return new Response(JSON.stringify({ error: "workflowId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Confirm workflow exists and caller can see it
  const wf = await getWorkflow(body.workflowId, auth.identity);
  if (!wf) {
    return new Response(JSON.stringify({ error: "Workflow not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const attachment = await attachWorkflow({
    taskId,
    workflowId: body.workflowId,
    attachedBy: auth.identity,
  });

  return attachment;
});
