import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  jsonb,
  index,
  timestamp,
} from "drizzle-orm/pg-core";

export const notebookPages = pgTable(
  "notebook_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: varchar("title", { length: 255 }).notNull(),
    content: text("content").notNull().default(""),
    createdBy: varchar("created_by", { length: 50 }).notNull(),
    taggedUsers: jsonb("tagged_users").$type<string[]>(),
    locked: boolean("locked").notNull().default(false),
    lockedBy: varchar("locked_by", { length: 50 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("notebook_pages_created_at_idx").on(table.createdAt),
  ],
);
