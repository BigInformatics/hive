import { defineEventHandler, getQuery } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { listTasks } from "@/lib/swarm";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const query = getQuery(event);
  const tasks = await listTasks({
    statuses: query.statuses
      ? (query.statuses as string).split(",") as any[]
      : undefined,
    assignee: query.assignee as string | undefined,
    projectId: query.projectId as string | undefined,
    includeCompleted: query.includeCompleted === "true",
  });

  return { tasks };
});
