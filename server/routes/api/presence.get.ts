import { defineEventHandler } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { getUnreadCounts } from "@/lib/messages";
import { getPresence, updatePresence } from "@/lib/presence";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);

  // Update presence for authenticated users
  if (auth) {
    updatePresence(auth.identity, "api");
  }

  const [presence, unreadCounts] = await Promise.all([
    getPresence(),
    getUnreadCounts(),
  ]);

  // Merge unread counts into presence
  const result: Record<string, unknown> = {};
  const allUsers = new Set([
    ...Object.keys(presence),
    ...Object.keys(unreadCounts),
  ]);

  for (const user of allUsers) {
    result[user] = {
      ...(presence[user] || { online: false, lastSeen: null, source: null }),
      unread: unreadCounts[user] || 0,
    };
  }

  return result;
});
