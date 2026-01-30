// Broadcast webhooks database operations
import { sql } from "./client";
import { randomBytes } from "crypto";

export interface Webhook {
  id: number;
  appName: string;
  token: string;
  title: string;
  owner: string;
  forUsers: string | null;
  enabled: boolean;
  createdAt: Date;
  lastHitAt: Date | null;
}

export interface BroadcastEvent {
  id: number;
  webhookId: number;
  appName: string;
  title: string;
  forUsers: string | null;
  receivedAt: Date;
  contentType: string | null;
  bodyText: string | null;
  bodyJson: unknown | null;
}

// Generate a 14-character hex token (7 bytes)
function generateToken(): string {
  return randomBytes(7).toString("hex");
}

// Create a new webhook
export async function createWebhook(params: {
  appName: string;
  title: string;
  owner: string;
  forUsers?: string;
}): Promise<Webhook> {
  const token = generateToken();
  
  const [row] = await sql`
    INSERT INTO public.broadcast_webhooks (app_name, token, title, owner, for_users)
    VALUES (${params.appName}, ${token}, ${params.title}, ${params.owner}, ${params.forUsers || null})
    RETURNING *
  `;
  
  return mapWebhook(row);
}

// List webhooks (optionally filter by owner)
export async function listWebhooks(owner?: string): Promise<Webhook[]> {
  const rows = owner
    ? await sql`SELECT * FROM public.broadcast_webhooks WHERE owner = ${owner} ORDER BY created_at DESC`
    : await sql`SELECT * FROM public.broadcast_webhooks ORDER BY created_at DESC`;
  
  return rows.map(mapWebhook);
}

// Get webhook by app_name and token
export async function getWebhookByToken(appName: string, token: string): Promise<Webhook | null> {
  const [row] = await sql`
    SELECT * FROM public.broadcast_webhooks 
    WHERE app_name = ${appName} AND token = ${token}
  `;
  
  return row ? mapWebhook(row) : null;
}

// Get webhook by ID
export async function getWebhookById(id: number): Promise<Webhook | null> {
  const [row] = await sql`SELECT * FROM public.broadcast_webhooks WHERE id = ${id}`;
  return row ? mapWebhook(row) : null;
}

// Enable/disable webhook
export async function setWebhookEnabled(id: number, enabled: boolean): Promise<Webhook | null> {
  const [row] = await sql`
    UPDATE public.broadcast_webhooks 
    SET enabled = ${enabled}
    WHERE id = ${id}
    RETURNING *
  `;
  
  return row ? mapWebhook(row) : null;
}

// Delete webhook
export async function deleteWebhook(id: number): Promise<boolean> {
  const result = await sql`DELETE FROM public.broadcast_webhooks WHERE id = ${id}`;
  return result.count > 0;
}

// Record a broadcast event
export async function recordEvent(params: {
  webhookId: number;
  appName: string;
  title: string;
  forUsers: string | null;
  contentType: string | null;
  bodyText: string | null;
  bodyJson: unknown | null;
}): Promise<BroadcastEvent> {
  // Update last_hit_at on the webhook
  await sql`
    UPDATE public.broadcast_webhooks 
    SET last_hit_at = NOW() 
    WHERE id = ${params.webhookId}
  `;
  
  const [row] = await sql`
    INSERT INTO public.broadcast_events 
      (webhook_id, app_name, title, for_users, content_type, body_text, body_json)
    VALUES 
      (${params.webhookId}, ${params.appName}, ${params.title}, ${params.forUsers}, 
       ${params.contentType}, ${params.bodyText}, ${params.bodyJson ?? null})
    RETURNING *
  `;
  
  return mapEvent(row);
}

// List recent events (optionally filter by app_name or for specific user)
export async function listEvents(params?: {
  appName?: string;
  forUser?: string;
  limit?: number;
}): Promise<BroadcastEvent[]> {
  const limit = params?.limit || 100;
  
  let rows;
  if (params?.appName) {
    rows = await sql`
      SELECT * FROM public.broadcast_events 
      WHERE app_name = ${params.appName}
      ORDER BY received_at DESC 
      LIMIT ${limit}
    `;
  } else {
    rows = await sql`
      SELECT * FROM public.broadcast_events 
      ORDER BY received_at DESC 
      LIMIT ${limit}
    `;
  }
  
  // Filter by user if specified (check for_users field)
  let events = rows.map(mapEvent);
  if (params?.forUser) {
    events = events.filter(e => {
      if (!e.forUsers) return true; // null = everyone
      const users = e.forUsers.split(",").map(u => u.trim().toLowerCase());
      return users.includes(params.forUser!.toLowerCase());
    });
  }
  
  return events;
}

// Cleanup old events (keep last N per webhook)
export async function cleanupEvents(keepPerWebhook: number = 500): Promise<number> {
  const result = await sql`
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY webhook_id ORDER BY received_at DESC) as rn
      FROM public.broadcast_events
    )
    DELETE FROM public.broadcast_events 
    WHERE id IN (SELECT id FROM ranked WHERE rn > ${keepPerWebhook})
  `;
  
  return result.count;
}

// Helper to map DB row to Webhook
function mapWebhook(row: any): Webhook {
  return {
    id: row.id,
    appName: row.app_name,
    token: row.token,
    title: row.title,
    owner: row.owner,
    forUsers: row.for_users,
    enabled: row.enabled,
    createdAt: row.created_at,
    lastHitAt: row.last_hit_at,
  };
}

// Helper to map DB row to BroadcastEvent
function mapEvent(row: any): BroadcastEvent {
  return {
    id: row.id,
    webhookId: row.webhook_id,
    appName: row.app_name,
    title: row.title,
    forUsers: row.for_users,
    receivedAt: row.received_at,
    contentType: row.content_type,
    bodyText: row.body_text,
    bodyJson: row.body_json,
  };
}
