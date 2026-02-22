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
  // Support both `statuses=a,b,c` (canonical) and `status=a` (legacy/convenience alias)
  const statusParam = (query.statuses as string) || (query.status as string) || "";
  const tasks = await listTasks({
    statuses: statusParam ? (statusParam.split(",") as any[]) : undefined,
    assignee: query.assignee as string | undefined,
    projectId: query.projectId as string | undefined,
    includeCompleted: query.includeCompleted === "true",
  });

  return { tasks };
});
