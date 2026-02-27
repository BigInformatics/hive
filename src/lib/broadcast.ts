import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  type BroadcastEvent,
  type BroadcastWebhook,
  broadcastEvents,
  broadcastWebhooks,
} from "@/db/schema";

function generateToken(): string {
  return randomBytes(7).toString("hex");
}

export async function createWebhook(params: {
  appName: string;
  title: string;
  owner: string;
  forUsers?: string;
  wakeAgent?: string;
  notifyAgent?: string;
}): Promise<BroadcastWebhook> {
  const token = generateToken();
  const [row] = await db
    .insert(broadcastWebhooks)
    .values({
      appName: params.appName,
      token,
      title: params.title,
      owner: params.owner,
      forUsers: params.forUsers || null,
      wakeAgent: params.wakeAgent || null,
      notifyAgent: params.notifyAgent || null,
    })
    .returning();
  return row;
}

export async function listWebhooks(
  owner?: string,
): Promise<BroadcastWebhook[]> {
  if (owner) {
    return db
      .select()
      .from(broadcastWebhooks)
      .where(eq(broadcastWebhooks.owner, owner))
      .orderBy(desc(broadcastWebhooks.createdAt));
  }
  return db
    .select()
    .from(broadcastWebhooks)
    .orderBy(desc(broadcastWebhooks.createdAt));
}

export async function getWebhookByToken(
  appName: string,
  token: string,
): Promise<BroadcastWebhook | null> {
  const [row] = await db
    .select()
    .from(broadcastWebhooks)
    .where(
      and(
        eq(broadcastWebhooks.appName, appName),
        eq(broadcastWebhooks.token, token),
      ),
    );
  return row || null;
}

function stableJson(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function eventSignature(params: {
  title: string;
  bodyText: string | null;
  bodyJson: unknown | null;
  forUsers: string | null;
  contentType: string | null;
}): string {
  return `${params.title}\n${params.bodyText ?? ""}\n${stableJson(params.bodyJson)}\n${params.forUsers ?? ""}\n${params.contentType ?? ""}`;
}

export async function recordEventWithCooldown(
  params: {
    webhookId: number;
    appName: string;
    title: string;
    forUsers: string | null;
    contentType: string | null;
    bodyText: string | null;
    bodyJson: unknown | null;
  },
  cooldownMs = 0,
): Promise<{ event: BroadcastEvent; inserted: boolean }> {
  // Update last_hit_at
  await db
    .update(broadcastWebhooks)
    .set({ lastHitAt: new Date() })
    .where(eq(broadcastWebhooks.id, params.webhookId));

  if (cooldownMs > 0) {
    const recent = await db
      .select()
      .from(broadcastEvents)
      .where(eq(broadcastEvents.webhookId, params.webhookId))
      .orderBy(desc(broadcastEvents.receivedAt))
      .limit(50);

    const incomingSig = eventSignature({
      title: params.title,
      bodyText: params.bodyText,
      bodyJson: params.bodyJson,
      forUsers: params.forUsers,
      contentType: params.contentType,
    });
    const nowMs = Date.now();

    const dupe = recent.find((e) => {
      const ageMs = nowMs - new Date(e.receivedAt).getTime();
      if (ageMs > cooldownMs) return false;
      return (
        eventSignature({
          title: e.title,
          bodyText: e.bodyText,
          bodyJson: e.bodyJson,
          forUsers: e.forUsers,
          contentType: e.contentType,
        }) === incomingSig
      );
    });

    if (dupe) return { event: dupe, inserted: false };
  }

  const [row] = await db
    .insert(broadcastEvents)
    .values({
      webhookId: params.webhookId,
      appName: params.appName,
      title: params.title,
      forUsers: params.forUsers,
      contentType: params.contentType,
      bodyText: params.bodyText,
      bodyJson: params.bodyJson,
    })
    .returning();

  return { event: row, inserted: true };
}

export async function recordEvent(params: {
  webhookId: number;
  appName: string;
  title: string;
  forUsers: string | null;
  contentType: string | null;
  bodyText: string | null;
  bodyJson: unknown | null;
}): Promise<BroadcastEvent> {
  const { event } = await recordEventWithCooldown(params, 0);
  return event;
}

export async function listEvents(params?: {
  appName?: string;
  forUser?: string;
  limit?: number;
}): Promise<BroadcastEvent[]> {
  const limit = Math.min(params?.limit || 50, 100);

  let rows: BroadcastEvent[];
  if (params?.appName) {
    rows = await db
      .select()
      .from(broadcastEvents)
      .where(eq(broadcastEvents.appName, params.appName))
      .orderBy(desc(broadcastEvents.receivedAt))
      .limit(limit);
  } else {
    rows = await db
      .select()
      .from(broadcastEvents)
      .orderBy(desc(broadcastEvents.receivedAt))
      .limit(limit);
  }

  if (params?.forUser) {
    const forUser = params.forUser.toLowerCase();
    rows = rows.filter((e) => {
      if (!e.forUsers) return true;
      const users = e.forUsers.split(",").map((u) => u.trim().toLowerCase());
      return users.includes(forUser);
    });
  }

  return rows;
}

export async function getWebhookByAppName(
  appName: string,
): Promise<BroadcastWebhook | null> {
  const [row] = await db
    .select()
    .from(broadcastWebhooks)
    .where(eq(broadcastWebhooks.appName, appName))
    .limit(1);
  return row || null;
}

// For internal events (swarm buzz, etc.)
const internalWebhookCache = new Map<string, number>();

export async function ensureInternalWebhook(
  appName: string,
  title: string,
  owner = "system",
): Promise<number> {
  const cached = internalWebhookCache.get(appName);
  if (cached) return cached;

  let webhook = await getWebhookByAppName(appName);
  if (!webhook) {
    webhook = await createWebhook({ appName, title, owner });
    console.log(
      `[broadcast] Created internal webhook for ${appName}: id=${webhook.id}`,
    );
  }

  internalWebhookCache.set(appName, webhook.id);
  return webhook.id;
}

export async function emitInternalEvent(params: {
  appName: string;
  appTitle: string;
  title: string;
  body: unknown;
  forUsers?: string;
}): Promise<BroadcastEvent> {
  const webhookId = await ensureInternalWebhook(
    params.appName,
    params.appTitle,
  );
  return recordEvent({
    webhookId,
    appName: params.appName,
    title: params.title,
    forUsers: params.forUsers || null,
    contentType: "application/json",
    bodyText: null,
    bodyJson: params.body,
  });
}
