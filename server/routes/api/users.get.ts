import { defineEventHandler } from "h3";
import { authenticateEvent, listUsers } from "@/lib/auth";

/**
 * GET /api/users
 * Returns all active users. Requires authentication (not admin-only).
 * All users, including the superuser, are guaranteed to have a row in the
 * users table (auto-created at startup for the superuser).
 */
export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const dbUsers = await listUsers();
  return { users: dbUsers };
});
