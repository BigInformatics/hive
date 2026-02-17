import { defineEventHandler, getQuery } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { searchChatMessages } from "@/lib/chat";
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

  const query = getQuery(event);
  if (!query.q) {
    return new Response(
      JSON.stringify({ error: "q (query) parameter is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const messages = await searchChatMessages(
    auth.identity,
    query.q as string,
    {
      limit: query.limit ? Number(query.limit) : undefined,
      channelId: query.channelId as string | undefined,
      sender: query.sender as string | undefined,
      before: query.before as string | undefined,
      after: query.after as string | undefined,
    },
  );

  return { messages };
});
