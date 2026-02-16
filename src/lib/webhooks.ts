/**
 * Agent webhook dispatch — notifies agents when they receive chat messages.
 * 
 * Looks up webhook config from:
 * 1. mailbox_tokens table (webhook_url + webhook_token columns)
 * 2. Environment variables: WEBHOOK_<IDENTITY>_URL and WEBHOOK_<IDENTITY>_TOKEN
 */

import { db } from "@/db";
import { mailboxTokens } from "@/db/schema";
import { eq, isNull, isNotNull } from "drizzle-orm";

interface WebhookConfig {
  url: string;
  token: string;
}

// Cache webhook configs for 60s
let webhookCache: Map<string, WebhookConfig> | null = null;
let cacheTime = 0;
const CACHE_TTL = 60_000;

/** Clear the cache so webhook changes take effect immediately */
export function clearWebhookCache() {
  webhookCache = null;
  cacheTime = 0;
}

async function getWebhookConfigs(): Promise<Map<string, WebhookConfig>> {
  const now = Date.now();
  if (webhookCache && now - cacheTime < CACHE_TTL) return webhookCache;

  const configs = new Map<string, WebhookConfig>();

  // Check DB tokens with webhook URLs
  try {
    const rows = await db
      .select({
        identity: mailboxTokens.identity,
        webhookUrl: mailboxTokens.webhookUrl,
        webhookToken: mailboxTokens.webhookToken,
      })
      .from(mailboxTokens)
      .where(isNull(mailboxTokens.revokedAt));

    for (const row of rows) {
      if (row.webhookUrl && row.webhookToken) {
        configs.set(row.identity, { url: row.webhookUrl, token: row.webhookToken });
      }
    }
  } catch (err) {
    console.error("[webhooks] DB lookup failed:", err);
  }

  // Check env vars (override DB)
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("WEBHOOK_") && key.endsWith("_URL") && value) {
      const identity = key.slice(8, -4).toLowerCase();
      const token = process.env[`WEBHOOK_${identity.toUpperCase()}_TOKEN`];
      if (token) {
        configs.set(identity, { url: value, token });
      }
    }
  }

  webhookCache = configs;
  cacheTime = now;
  return configs;
}

/**
 * Notify an agent about a new chat message via their webhook.
 * Non-blocking — fires and forgets, logs errors.
 */
export async function notifyChatMessage(
  recipientIdentity: string,
  channelId: string,
  sender: string,
  body: string,
): Promise<void> {
  const configs = await getWebhookConfigs();
  const config = configs.get(recipientIdentity);
  if (!config) return; // Not an agent or no webhook configured

  try {
    const payload = {
      message: `New Hive chat message from ${sender}: "${body}"\n\nChannel: ${channelId}\n\nCheck and respond via: curl -sS -H "Authorization: Bearer $HIVE_TOKEN" "https://messages.biginformatics.net/api/chat/channels/${channelId}/messages"\n\nTo reply: curl -sS -X POST -H "Authorization: Bearer $HIVE_TOKEN" -H "Content-Type: application/json" -d '{"body":"YOUR_REPLY"}' "https://messages.biginformatics.net/api/chat/channels/${channelId}/messages"`,
      wakeMode: "now",
    };

    const resp = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      console.error(`[webhooks] ${recipientIdentity} webhook failed: ${resp.status}`);
    }
  } catch (err) {
    console.error(`[webhooks] ${recipientIdentity} webhook error:`, err);
  }
}
