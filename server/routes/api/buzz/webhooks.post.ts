import { defineEventHandler, readBody } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { createWebhook } from "@/lib/buzz";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = (await readBody<Record<string, any>>(event)) ?? {};
  if (!body?.appName || !body?.title) {
    return new Response(
      JSON.stringify({ error: "appName and title are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const webhook = await createWebhook({
    appName: body.appName,
    title: body.title,
    owner: auth.identity,
    forUsers: body.forUsers,
    wakeAgent: body.wakeAgent,
    notifyAgent: body.notifyAgent,
  });

  return webhook;
});
