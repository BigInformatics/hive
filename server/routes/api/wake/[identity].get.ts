import { defineEventHandler, getRouterParam, getQuery } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { getWakeItems } from "@/lib/wake";

/** Admin endpoint: get wake items for a specific identity */
export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Only admins can view other users' wake items
  if (!auth.isAdmin) {
    return new Response(JSON.stringify({ error: "Admin required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const identity = getRouterParam(event, "identity");
  if (!identity) {
    return new Response(JSON.stringify({ error: "identity required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const query = getQuery(event);
  const includeOffHours = query.includeOffHours === "true";

  // Don't mark buzz events as delivered when viewing as admin
  const payload = await getWakeItems(identity, { includeOffHours });
  return payload;
});
