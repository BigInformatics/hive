import { defineEventHandler, readBody } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { createGroupChannel, getOrCreateDm } from "@/lib/chat";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await readBody(event);

  if (body?.type === "group") {
    if (!body.name || !body.members?.length) {
      return new Response(
        JSON.stringify({ error: "name and members required for group chat" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    const channelId = await createGroupChannel(
      body.name,
      auth.identity,
      body.members,
    );
    return { channelId, type: "group" };
  }

  // Default: DM
  if (!body?.identity) {
    return new Response(JSON.stringify({ error: "identity required for DM" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const channelId = await getOrCreateDm(auth.identity, body.identity);
  return { channelId, type: "dm" };
});
