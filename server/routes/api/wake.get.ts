import { defineEventHandler, getQuery } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { updatePresence } from "@/lib/presence";
import { getWakeItems, markBuzzEventsDelivered } from "@/lib/wake";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  updatePresence(auth.identity, "api");

  const query = getQuery(event);
  const includeOffHours = query.includeOffHours === "true";

  const payload = await getWakeItems(auth.identity, { includeOffHours });

  // Mark ephemeral buzz events as delivered so they don't appear again
  if (payload.items.length > 0) {
    await markBuzzEventsDelivered(payload.items);
  }

  return payload;
});
