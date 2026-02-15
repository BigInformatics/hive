import { defineEventHandler, readBody } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { createTask } from "@/lib/swarm";
import { emit } from "@/lib/events";

export default defineEventHandler(async (event) => {
  const auth = authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await readBody(event);
  if (!body?.title) {
    return new Response(JSON.stringify({ error: "title is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const task = await createTask({
    projectId: body.projectId,
    title: body.title,
    detail: body.detail,
    issueUrl: body.issueUrl,
    creatorUserId: auth.identity,
    assigneeUserId: body.assigneeUserId,
    status: body.status,
    onOrAfterAt: body.onOrAfterAt ? new Date(body.onOrAfterAt) : undefined,
    mustBeDoneAfterTaskId: body.mustBeDoneAfterTaskId,
    nextTaskId: body.nextTaskId,
    nextTaskAssigneeUserId: body.nextTaskAssigneeUserId,
  });

  emit("__swarm__", {
    type: "swarm_task_created",
    taskId: task.id,
    title: task.title,
    status: task.status,
    actor: auth.identity,
  });

  return task;
});
