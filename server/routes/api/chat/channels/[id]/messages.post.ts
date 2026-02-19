import { defineEventHandler, getRouterParam, readBody } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { getChannelMembers, isMember, sendChatMessage } from "@/lib/chat";
import { emit } from "@/lib/events";
import { notifyChatMessage } from "@/lib/webhooks";

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

  const body = await readBody(event);
  if (!body?.body?.trim()) {
    return new Response(JSON.stringify({ error: "body required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const message = await sendChatMessage(
    channelId,
    auth.identity,
    body.body.trim(),
  );

  // Emit SSE event to all channel members
  const members = await getChannelMembers(channelId);
  for (const member of members) {
    emit(member, {
      type: "chat_message",
      channelId,
      message: {
        id: message.id,
        sender: message.sender,
        body: message.body,
        createdAt: message.createdAt,
      },
    });

    // Notify agents via webhook (non-blocking, fire-and-forget)
    if (member !== auth.identity) {
      notifyChatMessage(member, channelId, auth.identity, message.body).catch(
        () => {},
      );
    }
  }

  return message;
});
