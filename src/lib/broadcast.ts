import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  broadcastWebhooks,
  broadcastEvents,
  type BroadcastWebhook,
  type BroadcastEvent,
} from "@/db/schema";
import { randomBytes } from "crypto";

function generateToken(): string {
  return randomBytes(7).toString("hex");
}

export async function createWebhook(params: {
  appName: string;
  title: string;
  owner: string;
  forUsers?: string;
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

export async function recordEvent(params: {
  webhookId: number;
  appName: string;
  title: string;
  forUsers: string | null;
  contentType: string | null;
  bodyText: string | null;
  bodyJson: unknown | null;
}): Promise<BroadcastEvent> {
  // Update last_hit_at
  await db
    .update(broadcastWebhooks)
    .set({ lastHitAt: new Date() })
    .where(eq(broadcastWebhooks.id, params.webhookId));

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
  return row;
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
    rows = rows.filter((e) => {
      if (!e.forUsers) return true;
      const users = e.forUsers.split(",").map((u) => u.trim().toLowerCase());
      return users.includes(params.forUser!.toLowerCase());
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
