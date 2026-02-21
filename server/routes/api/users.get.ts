import { defineEventHandler } from "h3";
import { authenticateEvent, getEnvIdentities, listUsers } from "@/lib/auth";

/**
 * GET /api/users
 * Returns all active users. Requires authentication (not admin-only).
 * Includes users from the users table AND env-token identities that haven't
 * been backfilled yet (returned as minimal user objects).
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
  const dbIds = new Set(dbUsers.map((u) => u.id));

  // Include env-token identities not yet in the users table
  const envOnly = getEnvIdentities()
    .filter((id) => !dbIds.has(id))
    .map((id) => ({
      id,
      displayName: id,
      isAdmin: false,
      isAgent: false,
      avatarUrl: null,
      createdAt: null,
      updatedAt: null,
      lastSeenAt: null,
      archivedAt: null,
    }));

  return { users: [...dbUsers, ...envOnly] };
});
