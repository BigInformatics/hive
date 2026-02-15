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
// TYPES
// ============================================================

export type MailboxMessage = typeof mailboxMessages.$inferSelect;
export type NewMailboxMessage = typeof mailboxMessages.$inferInsert;
export type HiveEvent = typeof hiveEvents.$inferSelect;
