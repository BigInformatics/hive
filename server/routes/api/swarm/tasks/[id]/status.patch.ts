import { defineEventHandler, getRouterParam, readBody } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { emit, emitWakeTrigger } from "@/lib/events";
import { getTask, updateTaskStatus } from "@/lib/swarm";

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

  const body = await readBody(event);
  if (!body?.status) {
    return new Response(JSON.stringify({ error: "status required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const before = await getTask(id);
  const task = await updateTaskStatus(id, body.status, auth.identity);
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
    previousStatus: before?.status,
    actor: auth.identity,
  });

  // Trigger wake pulse for assignee if task entered a wakeable status
  const wakeStatuses = ["ready", "in_progress", "review"];
  if (task.assigneeUserId && wakeStatuses.includes(task.status)) {
    emitWakeTrigger(task.assigneeUserId);
  }

  return task;
});
