import { and, eq, isNull, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import {
  mailboxMessages,
  broadcastEvents,
  broadcastWebhooks,
  swarmTasks,
  swarmProjects,
  mailboxTokens,
} from "@/db/schema";
import { getPresence } from "./presence";

// ============================================================
// Types
// ============================================================

export interface WakeItem {
  source: "message" | "message_pending" | "swarm" | "buzz" | "backup";
  id: string | number;
  summary: string;
  action: string;
  priority: "low" | "normal" | "high";
  age?: string;
  ephemeral: boolean;
  // Source-specific fields
  status?: string;
  role?: "wake" | "notify";
  appName?: string;
  projectId?: string | null;
  targetAgent?: string;
  staleSince?: string;
}

export interface WakeAction {
  item: string;
  action: string;
  skill_url: string;
}

export interface WakePayload {
  instructions: string;
  skill_url: string;
  items: WakeItem[];
  actions: WakeAction[];
  summary: string | null;
  timestamp: string;
}

// ============================================================
// Helpers
// ============================================================

function formatAge(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remH = hours % 24;
    return remH > 0 ? `${days}d ${remH}h` : `${days}d`;
  }
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/** Check if current time is within a project's working hours */
function isWithinWorkHours(project: {
  workHoursStart: number | null;
  workHoursEnd: number | null;
  workHoursTimezone: string | null;
}): boolean {
  if (project.workHoursStart == null || project.workHoursEnd == null) return true;
  const tz = project.workHoursTimezone || "America/Chicago";
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
  });
  const currentHour = Number.parseInt(formatter.format(now), 10);
  return currentHour >= project.workHoursStart && currentHour < project.workHoursEnd;
}

const SWARM_CTA: Record<string, string> = {
  ready: "This task is assigned to you and ready to start. Pick it up or reassign.",
  in_progress:
    "You are assigned and this is in progress. Verify you are actively working on it. Update status when complete.",
  review: "This task is awaiting your review. Review and either approve or send back.",
};

// ============================================================
// Core wake query
// ============================================================

export async function getWakeItems(
  identity: string,
  options: { includeOffHours?: boolean } = {},
): Promise<WakePayload> {
  const now = new Date();

  // Load projects for working-hours filtering
  const projects = await db.select().from(swarmProjects);
  const projectMap = new Map(projects.map((p) => [p.id, p]));

  const shouldInclude = (projectId: string | null): boolean => {
    if (options.includeOffHours || !projectId) return true;
    const proj = projectMap.get(projectId);
    if (!proj) return true;
    return isWithinWorkHours(proj);
  };

  // --- 1. Unread messages ---
  const unread = await db
    .select()
    .from(mailboxMessages)
    .where(
      and(
        eq(mailboxMessages.recipient, identity),
        eq(mailboxMessages.status, "unread"),
      ),
    );

  const messageItems: WakeItem[] = unread.map((m) => ({
    source: "message" as const,
    id: m.id,
    summary: `From ${m.sender}: '${m.title}'`,
    action: "Read and respond to this message.",
    priority: m.urgent ? ("high" as const) : ("normal" as const),
    age: formatAge(now.getTime() - new Date(m.createdAt).getTime()),
    projectId: null,
    ephemeral: false,
  }));

  // --- 2. Pending messages (follow-up commitments) ---
  const pending = await db
    .select()
    .from(mailboxMessages)
    .where(
      and(
        eq(mailboxMessages.recipient, identity),
        eq(mailboxMessages.responseWaiting, true),
      ),
    );

  const pendingItems: WakeItem[] = pending.map((m) => {
    const waitingSince = m.waitingSince || m.createdAt;
    const age = formatAge(now.getTime() - new Date(waitingSince).getTime());
    return {
      source: "message_pending" as const,
      id: m.id,
      summary: `From ${m.sender}: '${m.title}'`,
      action: `You marked this for follow-up ${age} ago. Deliver on your commitment or clear pending.`,
      priority: "normal" as const,
      age,
      projectId: null,
      ephemeral: false,
    };
  });

  // --- 3. Swarm tasks (ready, in_progress, review) ---
  const wakeStatuses = ["ready", "in_progress", "review"];
  const tasks = await db
    .select()
    .from(swarmTasks)
    .where(
      and(
        eq(swarmTasks.assigneeUserId, identity),
        inArray(swarmTasks.status, wakeStatuses),
      ),
    );

  const taskItems: WakeItem[] = tasks
    .filter((t) => shouldInclude(t.projectId))
    .map((t) => ({
      source: "swarm" as const,
      id: t.id,
      summary: t.title,
      status: t.status,
      action: SWARM_CTA[t.status] || "Review this task.",
      priority: "normal" as const,
      age: formatAge(now.getTime() - new Date(t.createdAt).getTime()),
      projectId: t.projectId,
      ephemeral: false,
    }));

  // --- 4. Buzz events (wake agent) ---
  // Find webhooks where this identity is wake_agent, get undelivered events
  const wakeWebhooks = await db
    .select()
    .from(broadcastWebhooks)
    .where(eq(broadcastWebhooks.wakeAgent, identity));

  let buzzWakeItems: WakeItem[] = [];
  if (wakeWebhooks.length > 0) {
    const webhookIds = wakeWebhooks.map((w) => w.id);
    const wakeEvents = await db
      .select()
      .from(broadcastEvents)
      .where(
        and(
          inArray(broadcastEvents.webhookId, webhookIds),
          isNull(broadcastEvents.wakeDeliveredAt),
        ),
      );

    buzzWakeItems = wakeEvents.map((e) => ({
      source: "buzz" as const,
      id: e.id,
      role: "wake" as const,
      summary: e.bodyText
        ? `${e.title}: ${e.bodyText.slice(0, 100)}`
        : e.title,
      action:
        "You are assigned to monitor these events. Create a swarm task in ready to investigate this alert.",
      priority: "high" as const,
      appName: e.appName,
      ephemeral: true,
    }));
  }

  // --- 5. Buzz events (notify agent) ---
  const notifyWebhooks = await db
    .select()
    .from(broadcastWebhooks)
    .where(eq(broadcastWebhooks.notifyAgent, identity));

  let buzzNotifyItems: WakeItem[] = [];
  if (notifyWebhooks.length > 0) {
    const webhookIds = notifyWebhooks.map((w) => w.id);
    const notifyEvents = await db
      .select()
      .from(broadcastEvents)
      .where(
        and(
          inArray(broadcastEvents.webhookId, webhookIds),
          isNull(broadcastEvents.notifyDeliveredAt),
        ),
      );

    buzzNotifyItems = notifyEvents.map((e) => ({
      source: "buzz" as const,
      id: e.id,
      role: "notify" as const,
      summary: e.bodyText
        ? `${e.title}: ${e.bodyText.slice(0, 100)}`
        : e.title,
      action:
        "You are flagged for notification of this event. Review for awareness.",
      priority: "low" as const,
      appName: e.appName,
      ephemeral: true,
    }));
  }

  // --- 6. Backup agent alerts ---
  // Find agents that have this identity as backup_agent
  const backedUpTokens = await db
    .select()
    .from(mailboxTokens)
    .where(
      and(
        eq(mailboxTokens.backupAgent, identity),
        isNull(mailboxTokens.revokedAt),
      ),
    );

  const backupItems: WakeItem[] = [];
  if (backedUpTokens.length > 0) {
    const presence = await getPresence();

    for (const token of backedUpTokens) {
      const agent = token.identity;
      const triggerHours = token.staleTriggerHours || 4;
      const agentPresence = presence[agent];

      if (!agentPresence) continue;

      const lastSeen = agentPresence.lastSeen
        ? new Date(agentPresence.lastSeen).getTime()
        : 0;
      const hoursStale = (now.getTime() - lastSeen) / 3_600_000;

      if (hoursStale >= triggerHours) {
        // Check if the stale agent has any wake items
        const staleAgentUnread = await db
          .select()
          .from(mailboxMessages)
          .where(
            and(
              eq(mailboxMessages.recipient, agent),
              eq(mailboxMessages.status, "unread"),
            ),
          );
        const staleAgentTasks = await db
          .select()
          .from(swarmTasks)
          .where(
            and(
              eq(swarmTasks.assigneeUserId, agent),
              inArray(swarmTasks.status, wakeStatuses),
            ),
          );
        const pendingCount = staleAgentUnread.length + staleAgentTasks.length;
        if (pendingCount > 0) {
          backupItems.push({
            source: "backup",
            id: `backup-${agent}`,
            targetAgent: agent,
            summary: `${agent} unresponsive for ${Math.floor(hoursStale)}h with ${pendingCount} pending wake items`,
            action: `Check if ${agent} is offline and notify the team.`,
            priority: "high",
            staleSince: new Date(lastSeen).toISOString(),
            ephemeral: false,
          });
        }
      }
    }
  }

  // --- Combine all items ---
  const items: WakeItem[] = [
    ...messageItems,
    ...pendingItems,
    ...taskItems,
    ...buzzWakeItems,
    ...buzzNotifyItems,
    ...backupItems,
  ];

  // Build summary
  let summary: string | null = null;
  if (items.length > 0) {
    const counts: string[] = [];
    if (messageItems.length) counts.push(`${messageItems.length} unread message${messageItems.length > 1 ? "s" : ""}`);
    if (pendingItems.length) counts.push(`${pendingItems.length} pending follow-up${pendingItems.length > 1 ? "s" : ""}`);
    if (taskItems.length) counts.push(`${taskItems.length} active task${taskItems.length > 1 ? "s" : ""}`);
    if (buzzWakeItems.length) counts.push(`${buzzWakeItems.length} alert${buzzWakeItems.length > 1 ? "s" : ""}`);
    if (buzzNotifyItems.length) counts.push(`${buzzNotifyItems.length} notification${buzzNotifyItems.length > 1 ? "s" : ""}`);
    if (backupItems.length) counts.push(`${backupItems.length} backup check${backupItems.length > 1 ? "s" : ""}`);
    summary = `${items.length} item${items.length > 1 ? "s" : ""} need${items.length === 1 ? "s" : ""} your attention: ${counts.join(", ")}.`;
  }

  // --- Build per-source actions ---
  const { getBaseUrl } = await import("./base-url");
  const SKILL_BASE = `${getBaseUrl()}/api/skill`;
  const ACTION_MAP: Record<string, { item: string; action: string; skill_url: string }> = {
    message: {
      item: "messages",
      action: "You have unread messages in your inbox. Read and respond accordingly.",
      skill_url: SKILL_BASE,
    },
    message_pending: {
      item: "pending",
      action: "You have messages marked for follow-up. Deliver on your commitments or clear the pending flag.",
      skill_url: SKILL_BASE,
    },
    swarm: {
      item: "swarm",
      action: "You have active assigned tasks in swarm. Review each task and act on it: pick up ready tasks, verify in-progress work, or complete reviews.",
      skill_url: `${SKILL_BASE}/swarm`,
    },
    buzz: {
      item: "buzz",
      action: "You have buzz events requiring attention. For wake alerts, create a swarm task to investigate. For notifications, review for awareness.",
      skill_url: `${SKILL_BASE}/buzz`,
    },
    backup: {
      item: "backup",
      action: "An agent you back up appears unresponsive with pending work. Check on them and notify the team if needed.",
      skill_url: `${SKILL_BASE}/wake`,
    },
  };

  const activeSources = new Set(items.map((i) => i.source));
  const actions: WakeAction[] = [];
  for (const source of activeSources) {
    const a = ACTION_MAP[source];
    if (a) actions.push(a);
  }

  return {
    instructions: "When reading the actions within this document, you can use the skill_url to learn how to respond to the action.",
    skill_url: `${getBaseUrl()}/api/skill`,
    items,
    actions,
    summary,
    timestamp: now.toISOString(),
  };
}

/**
 * Mark ephemeral buzz events as delivered after they've been included in a wake response.
 */
export async function markBuzzEventsDelivered(items: WakeItem[]): Promise<void> {
  const now = new Date();
  const buzzItems = items.filter((i) => i.source === "buzz" && i.ephemeral);

  for (const item of buzzItems) {
    const id = item.id as number;
    if (item.role === "wake") {
      await db
        .update(broadcastEvents)
        .set({ wakeDeliveredAt: now })
        .where(eq(broadcastEvents.id, id));
    } else if (item.role === "notify") {
      await db
        .update(broadcastEvents)
        .set({ notifyDeliveredAt: now })
        .where(eq(broadcastEvents.id, id));
    }
  }
}
