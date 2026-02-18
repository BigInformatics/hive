import { defineEventHandler, readBody, getRouterParam } from "h3";
import { authenticateEvent, isValidMailbox } from "@/lib/auth";
import { sendMessage } from "@/lib/messages";
import { emit, emitWakeTrigger } from "@/lib/events";
import { updatePresence } from "@/lib/presence";

export default defineEventHandler(async (event) => {
  // Auth
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  updatePresence(auth.identity, "api");

  const recipient = getRouterParam(event, "recipient");
  if (!recipient || !isValidMailbox(recipient)) {
    return new Response(
      JSON.stringify({ error: "Invalid recipient mailbox" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const body = await readBody(event);
  if (!body?.title) {
    return new Response(JSON.stringify({ error: "title is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Input validation
  const title = String(body.title).slice(0, 255);
  const msgBody = body.body ? String(body.body).slice(0, 10_000) : body.body;

  const message = await sendMessage({
    recipient,
    sender: auth.identity,
    title,
    body: msgBody,
    urgent: body.urgent,
    threadId: body.threadId,
    replyToMessageId: body.replyToMessageId
      ? Number(body.replyToMessageId)
      : undefined,
    dedupeKey: body.dedupeKey,
    metadata: body.metadata,
  });

  // Emit event for real-time listeners
  emit(recipient, {
    type: "message",
    recipient,
    sender: auth.identity,
    messageId: message.id,
    title: message.title,
    urgent: message.urgent,
  });

  // Trigger immediate wake pulse for recipient
  emitWakeTrigger(recipient);

  return message;
});
