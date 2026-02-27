import { defineEventHandler } from "h3";
import { authenticateEvent, listUsers } from "@/lib/auth";
import { getUnreadCounts } from "@/lib/messages";
import { getPresence, updatePresence } from "@/lib/presence";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);

  // Update presence for authenticated users
  if (auth) {
    updatePresence(auth.identity, "api");
  }

  const [presence, unreadCounts, activeUsers] = await Promise.all([
    getPresence(),
    getUnreadCounts(),
    listUsers(),
  ]);

  // Merge unread counts into presence for active users only.
  const result: Record<string, unknown> = {};
  const activeUserIds = new Set(activeUsers.map((u) => u.id));

  for (const user of activeUserIds) {
    result[user] = {
      ...(presence[user] || { online: false, lastSeen: null, source: null }),
      unread: unreadCounts[user] || 0,
    };
  }

  return result;
});
