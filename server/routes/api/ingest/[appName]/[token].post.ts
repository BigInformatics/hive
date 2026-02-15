import { defineEventHandler, readBody, getRouterParam, getHeader } from "h3";
import { getWebhookByToken, recordEvent } from "@/lib/broadcast";

export default defineEventHandler(async (event) => {
  const appName = getRouterParam(event, "appName");
  const token = getRouterParam(event, "token");

  if (!appName || !token) {
    return new Response(JSON.stringify({ error: "Missing app name or token" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const webhook = await getWebhookByToken(appName, token);
  if (!webhook || !webhook.enabled) {
    return new Response(JSON.stringify({ error: "Invalid webhook" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const contentType = getHeader(event, "content-type") || "text/plain";
  let bodyText: string | null = null;
  let bodyJson: unknown | null = null;
  let title = webhook.title;

  try {
    const raw = await readBody(event);
    if (contentType.includes("application/json")) {
      bodyJson = raw;
      if (raw?.title) title = raw.title;
      if (raw?.body) bodyText = raw.body;
    } else {
      bodyText = typeof raw === "string" ? raw : JSON.stringify(raw);
    }
  } catch {
    // Empty body is OK
  }

  const recorded = await recordEvent({
    webhookId: webhook.id,
    appName: webhook.appName,
    title,
    forUsers: webhook.forUsers,
    contentType,
    bodyText,
    bodyJson,
  });

  return { ok: true, eventId: recorded.id };
});
