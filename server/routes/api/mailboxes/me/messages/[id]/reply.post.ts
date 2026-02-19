import { defineEventHandler, getRouterParam, readBody } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { emit } from "@/lib/events";
import { replyToMessage } from "@/lib/messages";
import { updatePresence } from "@/lib/presence";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  updatePresence(auth.identity, "api");

  const id = getRouterParam(event, "id");
  if (!id) {
    return new Response(JSON.stringify({ error: "id is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await readBody(event);
  if (!body?.body) {
    return new Response(JSON.stringify({ error: "body is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const message = await replyToMessage(auth.identity, Number(id), body.body);
  if (!message) {
    return new Response(
      JSON.stringify({ error: "Message not found or not yours to reply to" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  // Emit event
  emit(message.recipient, {
    type: "message",
    recipient: message.recipient,
    sender: auth.identity,
    messageId: message.id,
    title: message.title,
    urgent: message.urgent,
  });

  return message;
});
