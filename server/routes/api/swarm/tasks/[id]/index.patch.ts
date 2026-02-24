import { defineEventHandler, getRouterParam, readBody } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { emit } from "@/lib/events";
import { updateTask } from "@/lib/swarm";

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

  const body = (await readBody<Record<string, any>>(event)) ?? {};
  const task = await updateTask(id, {
    projectId: body.projectId,
    title: body.title,
    detail: body.detail,
    followUp: body.followUp,
    issueUrl: body.issueUrl,
    assigneeUserId: body.assigneeUserId,
    onOrAfterAt: body.onOrAfterAt
      ? new Date(body.onOrAfterAt)
      : body.onOrAfterAt,
    mustBeDoneAfterTaskId: body.mustBeDoneAfterTaskId,
    nextTaskId: body.nextTaskId,
    nextTaskAssigneeUserId: body.nextTaskAssigneeUserId,
    linkedNotebookPages:
      body.linkedNotebookPages !== undefined
        ? Array.isArray(body.linkedNotebookPages) &&
          body.linkedNotebookPages.length > 0
          ? body.linkedNotebookPages
          : null
        : undefined,
  });

  if (!task) {
    return new Response(JSON.stringify({ error: "Task not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  emit("__swarm__", {
    type: "swarm_task_updated",
    taskId: task.id,
    title: task.title,
    status: task.status,
    actor: auth.identity,
  });

  return task;
});
