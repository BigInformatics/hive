import { defineEventHandler, getQuery } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { searchMessages } from "@/lib/messages";
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

  const query = getQuery(event);
  if (!query.q) {
    return new Response(
      JSON.stringify({ error: "q (query) parameter is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const messages = await searchMessages(auth.identity, query.q as string, {
    limit: query.limit ? Number(query.limit) : undefined,
  });

  return { messages };
});
