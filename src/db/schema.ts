import {
  bigserial,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

// ============================================================
// MAILBOX MESSAGES
// ============================================================

export const mailboxMessages = pgTable(
  "mailbox_messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    recipient: varchar("recipient", { length: 50 }).notNull(),
    sender: varchar("sender", { length: 50 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    body: text("body"),
    status: varchar("status", { length: 10 }).notNull().default("unread"),
    urgent: boolean("urgent").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    threadId: varchar("thread_id", { length: 100 }),
    replyToMessageId: bigserial("reply_to_message_id", {
      mode: "number",
    }),
    dedupeKey: varchar("dedupe_key", { length: 255 }),
    metadata: jsonb("metadata"),
    responseWaiting: boolean("response_waiting").notNull().default(false),
    waitingResponder: varchar("waiting_responder", { length: 50 }),
    waitingSince: timestamp("waiting_since", { withTimezone: true }),
  },
  (table) => [
    index("idx_mailbox_recipient_created").on(
      table.recipient,
      table.createdAt,
    ),
    index("idx_mailbox_waiting").on(table.waitingResponder, table.createdAt),
  ],
);

// ============================================================
// HIVE EVENTS (SSE resume + audit)
// ============================================================

export const hiveEvents = pgTable(
  "hive_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    type: text("type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    payload: jsonb("payload").notNull(),
  },
  (table) => [index("idx_hive_events_created").on(table.createdAt)],
);

// ============================================================
// BROADCAST WEBHOOKS
// ============================================================

export const broadcastWebhooks = pgTable(
  "broadcast_webhooks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    appName: varchar("app_name", { length: 50 }).notNull(),
    token: varchar("token", { length: 14 }).notNull().unique(),
    title: varchar("title", { length: 255 }).notNull(),
    owner: varchar("owner", { length: 50 }).notNull(),
    forUsers: varchar("for_users", { length: 255 }),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastHitAt: timestamp("last_hit_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_broadcast_webhooks_app_token").on(table.appName, table.token),
  ],
);

export const broadcastEvents = pgTable(
  "broadcast_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    webhookId: bigserial("webhook_id", { mode: "number" }).notNull(),
    appName: varchar("app_name", { length: 50 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    forUsers: varchar("for_users", { length: 255 }),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    contentType: varchar("content_type", { length: 100 }),
    bodyText: text("body_text"),
    bodyJson: jsonb("body_json"),
  },
  (table) => [
    index("idx_broadcast_events_app").on(table.appName, table.receivedAt),
  ],
);

// ============================================================
// SWARM: PROJECTS
// ============================================================

export const swarmProjects = pgTable("swarm_projects", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  description: text("description"),
  onedevUrl: text("onedev_url"),
  dokployDeployUrl: text("dokploy_deploy_url"),
  color: varchar("color", { length: 7 }).notNull(),
  projectLeadUserId: varchar("project_lead_user_id", { length: 50 }).notNull(),
  developerLeadUserId: varchar("developer_lead_user_id", {
    length: 50,
  }).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ============================================================
// SWARM: TASKS
// ============================================================

export const swarmTasks = pgTable(
  "swarm_tasks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id"),
    title: text("title").notNull(),
    detail: text("detail"),
    creatorUserId: varchar("creator_user_id", { length: 50 }).notNull(),
    assigneeUserId: varchar("assignee_user_id", { length: 50 }),
    status: varchar("status", { length: 20 }).notNull().default("queued"),
    onOrAfterAt: timestamp("on_or_after_at", { withTimezone: true }),
    mustBeDoneAfterTaskId: text("must_be_done_after_task_id"),
    sortKey: bigserial("sort_key", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_swarm_tasks_status").on(table.status),
    index("idx_swarm_tasks_assignee").on(table.assigneeUserId),
    index("idx_swarm_tasks_project").on(table.projectId),
  ],
);

// ============================================================
// SWARM: TASK EVENTS (audit trail)
// ============================================================

export const swarmTaskEvents = pgTable(
  "swarm_task_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    taskId: text("task_id").notNull(),
    actorUserId: varchar("actor_user_id", { length: 50 }).notNull(),
    kind: text("kind").notNull(),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_swarm_task_events_task").on(table.taskId, table.createdAt),
  ],
);

// ============================================================
// TYPES
// ============================================================

export type MailboxMessage = typeof mailboxMessages.$inferSelect;
export type NewMailboxMessage = typeof mailboxMessages.$inferInsert;
export type HiveEvent = typeof hiveEvents.$inferSelect;
export type BroadcastWebhook = typeof broadcastWebhooks.$inferSelect;
export type BroadcastEvent = typeof broadcastEvents.$inferSelect;
export type SwarmProject = typeof swarmProjects.$inferSelect;
export type SwarmTask = typeof swarmTasks.$inferSelect;
export type SwarmTaskEvent = typeof swarmTaskEvents.$inferSelect;
