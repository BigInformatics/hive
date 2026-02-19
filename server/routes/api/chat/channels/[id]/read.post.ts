import { defineEventHandler, getRouterParam } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { isMember, markChannelRead } from "@/lib/chat";

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
    return new Response(JSON.stringify({ error: "Missing channel id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!(await isMember(channelId, auth.identity))) {
    return new Response(JSON.stringify({ error: "Not a member" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  await markChannelRead(channelId, auth.identity);
  return { ok: true };
});
