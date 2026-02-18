import { defineEventHandler, getRouterParam, getQuery } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { getMessages, isMember, markChannelRead } from "@/lib/chat";

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

  const query = getQuery(event);
  const messages = await getMessages(channelId, {
    limit: query.limit ? Number(query.limit) : undefined,
    before: query.before ? Number(query.before) : undefined,
  });

  // Mark as read on fetch
  await markChannelRead(channelId, auth.identity);

  return { messages: messages.reverse() };
});
