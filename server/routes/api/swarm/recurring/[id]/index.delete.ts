import { defineEventHandler, getRouterParam } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { deleteRecurringTemplate } from "@/lib/recurring";

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

  const deleted = await deleteRecurringTemplate(id);
  if (!deleted) {
    return new Response(JSON.stringify({ error: "Template not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return { ok: true };
});
