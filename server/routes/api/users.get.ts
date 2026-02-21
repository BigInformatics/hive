import { defineEventHandler } from "h3";
import { authenticateEvent, listUsers } from "@/lib/auth";

/**
 * GET /api/users
 * Returns all active users. Requires authentication (not admin-only).
 */
export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const users = await listUsers();
  return { users };
});
