import { defineEventHandler, readBody } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { emit, emitWakeTrigger } from "@/lib/events";
import { createTask } from "@/lib/swarm";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await readBody<Record<string, any>>(event) ?? {};
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
    followUp: body.followUp,
    issueUrl: body.issueUrl,
    creatorUserId: auth.identity,
    assigneeUserId: body.assigneeUserId,
    status: body.status,
    onOrAfterAt: body.onOrAfterAt ? new Date(body.onOrAfterAt) : undefined,
    mustBeDoneAfterTaskId: body.mustBeDoneAfterTaskId,
    nextTaskId: body.nextTaskId,
    nextTaskAssigneeUserId: body.nextTaskAssigneeUserId,
    linkedNotebookPages: Array.isArray(body.linkedNotebookPages)
      ? body.linkedNotebookPages
      : undefined,
  });

  emit("__swarm__", {
    type: "swarm_task_created",
    taskId: task.id,
    title: task.title,
    status: task.status,
    actor: auth.identity,
  });

  // Trigger wake pulse for assignee
  const wakeStatuses = ["ready", "in_progress", "review"];
  if (task.assigneeUserId && wakeStatuses.includes(task.status)) {
    emitWakeTrigger(task.assigneeUserId);
  }

  return task;
});
