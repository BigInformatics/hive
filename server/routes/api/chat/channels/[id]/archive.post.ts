import { defineEventHandler, getRouterParam } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { archiveChannel, isMember } from "@/lib/chat";

/**
 * POST /api/chat/channels/:id/archive
 * Soft-deletes this channel from the current user's view.
 * Other members are unaffected.
 */
export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const channelId = getRouterParam(event, "id");
  if (!channelId) {
    return new Response(JSON.stringify({ error: "Channel ID required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const member = await isMember(channelId, auth.identity);
  if (!member) {
    return new Response(JSON.stringify({ error: "Not a member" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  await archiveChannel(channelId, auth.identity);
  return { ok: true };
});
