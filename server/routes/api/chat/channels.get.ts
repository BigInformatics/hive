import { defineEventHandler } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { listChannels } from "@/lib/chat";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const channels = await listChannels(auth.identity);
  return { channels };
});
