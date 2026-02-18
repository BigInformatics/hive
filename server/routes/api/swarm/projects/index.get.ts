import { defineEventHandler } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { listProjects } from "@/lib/swarm";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const projects = await listProjects();
  return { projects };
});
