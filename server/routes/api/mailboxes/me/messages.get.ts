import { defineEventHandler, getQuery } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { listMessages } from "@/lib/messages";
import { updatePresence } from "@/lib/presence";
import { emit } from "@/lib/events";

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
  const result = await listMessages(auth.identity, {
    status: query.status as "unread" | "read" | undefined,
    limit: query.limit ? Number(query.limit) : undefined,
    cursor: query.cursor as string | undefined,
  });

  emit(auth.identity, {
    type: "inbox_check",
    mailbox: auth.identity,
    action: "list",
  });

  return result;
});
