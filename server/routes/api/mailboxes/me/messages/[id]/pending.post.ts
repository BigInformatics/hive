import { defineEventHandler, getRouterParam } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { markWaiting } from "@/lib/messages";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const id = getRouterParam(event, "id");
  if (!id) {
    return new Response(JSON.stringify({ error: "id required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const message = await markWaiting(Number(id), auth.identity);
  if (!message) {
    return new Response(JSON.stringify({ error: "Message not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return message;
});
