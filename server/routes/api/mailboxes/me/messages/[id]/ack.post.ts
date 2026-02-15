import { defineEventHandler, getRouterParam } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { ackMessage } from "@/lib/messages";
import { updatePresence } from "@/lib/presence";

export default defineEventHandler(async (event) => {
  const auth = authenticateEvent(event);
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

  const message = await ackMessage(auth.identity, Number(id));
  if (!message) {
    return new Response(JSON.stringify({ error: "Message not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return message;
});
