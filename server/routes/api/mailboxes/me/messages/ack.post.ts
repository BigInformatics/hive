import { defineEventHandler, readBody } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { ackMessages } from "@/lib/messages";
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

  const body = await readBody(event);
  if (!body?.ids || !Array.isArray(body.ids)) {
    return new Response(
      JSON.stringify({ error: "ids array is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const result = await ackMessages(
    auth.identity,
    body.ids.map(Number),
  );

  return result;
});
