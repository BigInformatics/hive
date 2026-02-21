import { defineEventHandler } from "h3";
import { authenticateEvent, listUsers } from "@/lib/auth";
import { getPresence } from "@/lib/presence";

/**
 * GET /api/admin/users
 * Returns all active users enriched with presence data.
 * Admin only.
 */
export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!auth.isAdmin) {
    return new Response(JSON.stringify({ error: "Admin required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const [userRows, presence] = await Promise.all([listUsers(), getPresence()]);

  const enriched = userRows.map((user) => {
    const p = presence[user.id];
    return {
      ...user,
      online: p?.online ?? false,
      lastSeen: p?.lastSeen ?? null,
      presenceSource: p?.source ?? null,
    };
  });

  return { users: enriched };
});
