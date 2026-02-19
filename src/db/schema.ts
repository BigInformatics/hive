import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
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
    replyToMessageId: bigint("reply_to_message_id", { mode: "number" }),
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
    wakeAgent: varchar("wake_agent", { length: 50 }),
    notifyAgent: varchar("notify_agent", { length: 50 }),
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
    webhookId: bigint("webhook_id", { mode: "number" }).notNull(),
    appName: varchar("app_name", { length: 50 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    forUsers: varchar("for_users", { length: 255 }),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    contentType: varchar("content_type", { length: 100 }),
    bodyText: text("body_text"),
    bodyJson: jsonb("body_json"),
    wakeDeliveredAt: timestamp("wake_delivered_at", { withTimezone: true }),
    notifyDeliveredAt: timestamp("notify_delivered_at", { withTimezone: true }),
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
  websiteUrl: text("website_url"),
  onedevUrl: text("onedev_url"),
  githubUrl: text("github_url"),
  dokployDeployUrl: text("dokploy_deploy_url"),
  color: varchar("color", { length: 7 }).notNull(),
  projectLeadUserId: varchar("project_lead_user_id", { length: 50 }).notNull(),
  developerLeadUserId: varchar("developer_lead_user_id", {
    length: 50,
  }).notNull(),
  workHoursStart: integer("work_hours_start"),
  workHoursEnd: integer("work_hours_end"),
  workHoursTimezone: text("work_hours_timezone").default("America/Chicago"),
  blockingMode: boolean("blocking_mode").default(false),
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
    issueUrl: text("issue_url"),
    onOrAfterAt: timestamp("on_or_after_at", { withTimezone: true }),
    mustBeDoneAfterTaskId: text("must_be_done_after_task_id"),
    sortKey: bigint("sort_key", { mode: "number" }),
    nextTaskId: text("next_task_id"),
    nextTaskAssigneeUserId: varchar("next_task_assignee_user_id", { length: 50 }),
    recurringTemplateId: text("recurring_template_id"),
    recurringInstanceAt: timestamp("recurring_instance_at", { withTimezone: true }),
    linkedNotebookPages: jsonb("linked_notebook_pages").$type<string[]>(),
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
// SWARM: TASK ↔ NOTEBOOK PAGES (many-to-many)
// ============================================================

export const swarmTaskNotebookPages = pgTable("swarm_task_notebook_pages", {
  taskId: text("task_id").notNull().references(() => swarmTasks.id, { onDelete: "cascade" }),
  notebookPageId: uuid("notebook_page_id").notNull().references(() => notebookPages.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

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
// RECURRING TASK TEMPLATES
// ============================================================

export const recurringTemplates = pgTable("recurring_templates", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id"),
  title: text("title").notNull(),
  detail: text("detail"),
  assigneeUserId: varchar("assignee_user_id", { length: 50 }),
  creatorUserId: varchar("creator_user_id", { length: 50 }).notNull(),

  // Schedule: cron expression (e.g. "0 9 * * 1" = every Monday 9am)
  cronExpr: varchar("cron_expr", { length: 100 }).notNull(),
  timezone: varchar("timezone", { length: 50 }).notNull().default("America/Chicago"),

  // What status to create the task in
  initialStatus: varchar("initial_status", { length: 20 }).notNull().default("ready"),

  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ============================================================
// CHAT
// ============================================================

export const chatChannels = pgTable("chat_channels", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  type: varchar("type", { length: 10 }).notNull().default("dm"),
  name: varchar("name", { length: 100 }),
  createdBy: varchar("created_by", { length: 50 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const chatMembers = pgTable("chat_members", {
  channelId: text("channel_id").notNull().references(() => chatChannels.id, { onDelete: "cascade" }),
  identity: varchar("identity", { length: 50 }).notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }),
});

export const chatMessages = pgTable("chat_messages", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  channelId: text("channel_id").notNull().references(() => chatChannels.id, { onDelete: "cascade" }),
  sender: varchar("sender", { length: 50 }).notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  // search_tsv tsvector generated column exists in DB (GIN-indexed) — not mapped in Drizzle
});

// ============================================================
// AUTH: MAILBOX TOKENS
// ============================================================

export const mailboxTokens = pgTable("mailbox_tokens", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  identity: varchar("identity", { length: 50 }).notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  label: varchar("label", { length: 100 }),
  createdBy: varchar("created_by", { length: 50 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  // Webhook URL for agent notifications (chat messages, etc.)
  webhookUrl: varchar("webhook_url", { length: 500 }),
  webhookToken: varchar("webhook_token", { length: 200 }),
  // Backup agent: notified when this agent goes stale
  backupAgent: varchar("backup_agent", { length: 50 }),
  staleTriggerHours: integer("stale_trigger_hours").default(4),
});

// ============================================================
// AUTH: INVITES
// ============================================================

export const invites = pgTable("invites", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  createdBy: varchar("created_by", { length: 50 }).notNull(),
  identityHint: varchar("identity_hint", { length: 50 }),
  isAdmin: boolean("is_admin").notNull().default(false),
  maxUses: integer("max_uses").notNull().default(1),
  useCount: integer("use_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  // Pre-generated webhook token — human copies this to the agent's gateway config
  webhookToken: varchar("webhook_token", { length: 200 }),
});

// ============================================================
// NOTEBOOK PAGES — collaborative markdown notebook
// ============================================================

export const notebookPages = pgTable(
  "notebook_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: varchar("title", { length: 255 }).notNull(),
    content: text("content").notNull().default(""),
    createdBy: varchar("created_by", { length: 50 }).notNull(),
    taggedUsers: jsonb("tagged_users").$type<string[]>(),
    tags: jsonb("tags").$type<string[]>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    reviewAt: timestamp("review_at", { withTimezone: true }),
    tags: jsonb("tags").$type<string[]>().default([]),
    locked: boolean("locked").notNull().default(false),
    lockedBy: varchar("locked_by", { length: 50 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    reviewAt: timestamp("review_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_notebook_created_at").on(table.createdAt),
  ],
);

// ============================================================
// DIRECTORY ENTRIES — team link/bookmark directory
// ============================================================

export const directoryEntries = pgTable(
  "directory_entries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    title: varchar("title", { length: 255 }).notNull(),
    url: text("url").notNull(),
    description: text("description"),
    createdBy: varchar("created_by", { length: 50 }).notNull(),
    taggedUsers: jsonb("tagged_users").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_directory_created_at").on(table.createdAt),
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
export type RecurringTemplate = typeof recurringTemplates.$inferSelect;
export type ChatChannel = typeof chatChannels.$inferSelect;
export type ChatMember = typeof chatMembers.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type MailboxToken = typeof mailboxTokens.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type DirectoryEntry = typeof directoryEntries.$inferSelect;
export type NotebookPage = typeof notebookPages.$inferSelect;
export type SwarmTaskNotebookPage = typeof swarmTaskNotebookPages.$inferSelect;
