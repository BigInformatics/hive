import { defineEventHandler, getHeader, getRouterParam, readBody } from "h3";
import { getWebhookByToken, recordEventWithCooldown } from "@/lib/broadcast";
import { emitWakeTrigger } from "@/lib/events";

export default defineEventHandler(async (event) => {
  const appName = getRouterParam(event, "appName");
  const token = getRouterParam(event, "token");

  if (!appName || !token) {
    return new Response(
      JSON.stringify({ error: "Missing app name or token" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
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
    const raw = (await readBody<Record<string, any>>(event)) ?? {};
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

  const cooldownMinutes = Math.max(
    0,
    Number(process.env.BROADCAST_ALERT_COOLDOWN_MINUTES ?? "180") || 0,
  );

  const { event: recorded, inserted } = await recordEventWithCooldown(
    {
      webhookId: webhook.id,
      appName: webhook.appName,
      title,
      forUsers: webhook.forUsers,
      contentType,
      bodyText,
      bodyJson,
    },
    cooldownMinutes * 60_000,
  );

  // Trigger wake pulse only for newly-recorded events (suppressed duplicates stay quiet)
  if (inserted) {
    if (webhook.wakeAgent) emitWakeTrigger(webhook.wakeAgent);
    if (webhook.notifyAgent) emitWakeTrigger(webhook.notifyAgent);
  }

  return { ok: true, eventId: recorded.id, suppressed: !inserted };
});
