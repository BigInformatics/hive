import { defineEventHandler, readBody, getRouterParam } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { updateTask } from "@/lib/swarm";

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
  const task = await updateTask(id, {
    projectId: body.projectId,
    title: body.title,
    detail: body.detail,
    assigneeUserId: body.assigneeUserId,
    onOrAfterAt: body.onOrAfterAt ? new Date(body.onOrAfterAt) : body.onOrAfterAt,
    mustBeDoneAfterTaskId: body.mustBeDoneAfterTaskId,
  });

  if (!task) {
    return new Response(JSON.stringify({ error: "Task not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return task;
});
