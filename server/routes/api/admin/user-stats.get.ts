import { defineEventHandler } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { db } from "@/db";
import { mailboxMessages, swarmTasks, mailboxTokens } from "@/db/schema";
import { eq, and, inArray, sql as rawSql } from "drizzle-orm";
import { getPresence } from "@/lib/presence";

/**
 * GET /api/admin/user-stats
 * Returns per-user stats: inbox counts, swarm breakdown, presence, connection method.
 * Admin only.
 */
export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!auth.isAdmin) {
    return new Response(JSON.stringify({ error: "Admin required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Get all known identities from tokens
  const tokens = await db
    .select({
      identity: mailboxTokens.identity,
      webhookUrl: mailboxTokens.webhookUrl,
    })
    .from(mailboxTokens);

  const identities = [...new Set(tokens.map((t) => t.identity))];

  // Per-user inbox counts
  const inboxStats = await db
    .select({
      recipient: mailboxMessages.recipient,
      status: mailboxMessages.status,
      responseWaiting: mailboxMessages.responseWaiting,
      count: rawSql<number>`count(*)::int`,
    })
    .from(mailboxMessages)
    .groupBy(
      mailboxMessages.recipient,
      mailboxMessages.status,
      mailboxMessages.responseWaiting,
    );

  // Per-user swarm task counts by status
  const taskStats = await db
    .select({
      assignee: swarmTasks.assigneeUserId,
      status: swarmTasks.status,
      count: rawSql<number>`count(*)::int`,
    })
    .from(swarmTasks)
    .groupBy(swarmTasks.assigneeUserId, swarmTasks.status);

  // Presence
  const presence = await getPresence();

  // Build per-user response
  const users: Record<
    string,
    {
      inbox: { unread: number; pending: number; read: number; total: number };
      swarm: Record<string, number>;
      presence: { online: boolean; lastSeen: string | null; source: string | null };
      connection: string;
    }
  > = {};

  for (const identity of identities) {
    // Inbox
    const inbox = { unread: 0, pending: 0, read: 0, total: 0 };
    for (const row of inboxStats) {
      if (row.recipient !== identity) continue;
      const count = Number(row.count);
      inbox.total += count;
      if (row.status === "unread") inbox.unread += count;
      else if (row.status === "read") inbox.read += count;
      if (row.responseWaiting) inbox.pending += count;
    }

    // Swarm
    const swarm: Record<string, number> = {};
    for (const row of taskStats) {
      if (row.assignee !== identity) continue;
      swarm[row.status] = Number(row.count);
    }

    // Presence
    const p = presence[identity];
    const userPresence = p
      ? { online: p.online, lastSeen: p.lastSeen, source: p.source }
      : { online: false, lastSeen: null, source: null };

    // Connection method: check if they have a webhook URL or are on SSE
    const hasWebhook = tokens.some(
      (t) => t.identity === identity && t.webhookUrl,
    );
    let connection = "none";
    if (userPresence.source === "sse") connection = "sse";
    else if (hasWebhook) connection = "webhook";
    else if (userPresence.source === "api") connection = "api";

    users[identity] = { inbox, swarm, presence: userPresence, connection };
  }

  return { users };
});
