import { and, desc, eq, gt, sql as rawSql, asc } from "drizzle-orm";
import { db } from "@/db";
import { mailboxMessages } from "@/db/schema";
import type { MailboxMessage } from "@/db/schema";

export interface SendMessageInput {
  recipient: string;
  sender: string;
  title: string;
  body?: string;
  urgent?: boolean;
  threadId?: string;
  replyToMessageId?: number;
  dedupeKey?: string;
  metadata?: Record<string, unknown>;
}

export async function sendMessage(input: SendMessageInput): Promise<MailboxMessage> {
  // For dedupe, use raw SQL with ON CONFLICT
  if (input.dedupeKey) {
    const [row] = await db
      .insert(mailboxMessages)
      .values({
        recipient: input.recipient,
        sender: input.sender,
        title: input.title,
        body: input.body || null,
        urgent: input.urgent || false,
        threadId: input.threadId || null,
        replyToMessageId: input.replyToMessageId || undefined,
        dedupeKey: input.dedupeKey,
        metadata: input.metadata || null,
      })
      .onConflictDoNothing()
      .returning();

    if (!row) {
      // Conflict — fetch the existing one
      const [existing] = await db
        .select()
        .from(mailboxMessages)
        .where(
          and(
            eq(mailboxMessages.sender, input.sender),
            eq(mailboxMessages.recipient, input.recipient),
            eq(mailboxMessages.dedupeKey, input.dedupeKey),
          ),
        );
      return existing;
    }
    return row;
  }

  const [row] = await db
    .insert(mailboxMessages)
    .values({
      recipient: input.recipient,
      sender: input.sender,
      title: input.title,
      body: input.body || null,
      urgent: input.urgent || false,
      threadId: input.threadId || null,
      replyToMessageId: input.replyToMessageId || undefined,
      metadata: input.metadata || null,
    })
    .returning();

  return row;
}

export interface ListOptions {
  status?: "unread" | "read";
  limit?: number;
  cursor?: string;
}

export async function listMessages(
  recipient: string,
  options: ListOptions = {},
): Promise<{ messages: MailboxMessage[]; total: number; nextCursor?: string }> {
  const limit = Math.min(options.limit || 50, 100);
  const cursorId = options.cursor ? Number(options.cursor) : null;

  const conditions = [eq(mailboxMessages.recipient, recipient)];

  if (options.status) {
    conditions.push(eq(mailboxMessages.status, options.status));
  }

  // Get total count (before cursor filter)
  const [countResult] = await db
    .select({ count: rawSql<number>`count(*)::int` })
    .from(mailboxMessages)
    .where(and(...conditions));
  const total = countResult?.count ?? 0;

  if (cursorId) {
    conditions.push(gt(mailboxMessages.id, cursorId));
  }

  const orderBy =
    options.status === "unread"
      ? [desc(mailboxMessages.urgent), asc(mailboxMessages.createdAt)]
      : [desc(mailboxMessages.createdAt)];

  const rows = await db
    .select()
    .from(mailboxMessages)
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const messages = rows.slice(0, limit);
  const nextCursor =
    hasMore && messages.length > 0
      ? messages[messages.length - 1].id.toString()
      : undefined;

  return { messages, total, nextCursor };
}

export async function getMessage(
  identity: string,
  id: number,
): Promise<MailboxMessage | null> {
  const [row] = await db
    .select()
    .from(mailboxMessages)
    .where(eq(mailboxMessages.id, id));

  if (!row) return null;
  if (row.recipient !== identity && row.sender !== identity) return null;
  return row;
}

export async function ackMessage(
  recipient: string,
  id: number,
): Promise<MailboxMessage | null> {
  const [row] = await db
    .update(mailboxMessages)
    .set({
      status: "read",
      viewedAt: rawSql`COALESCE(${mailboxMessages.viewedAt}, NOW())`,
    })
    .where(
      and(eq(mailboxMessages.recipient, recipient), eq(mailboxMessages.id, id)),
    )
    .returning();

  return row || null;
}

export async function ackMessages(
  recipient: string,
  ids: number[],
): Promise<{ success: number[]; notFound: number[] }> {
  if (ids.length === 0) return { success: [], notFound: [] };

  const results = await Promise.all(
    ids.map((id) => ackMessage(recipient, id)),
  );

  const success: number[] = [];
  const notFound: number[] = [];

  for (let i = 0; i < ids.length; i++) {
    if (results[i]) success.push(ids[i]);
    else notFound.push(ids[i]);
  }

  return { success, notFound };
}

export async function searchMessages(
  recipient: string,
  query: string,
  options: { limit?: number } = {},
): Promise<MailboxMessage[]> {
  const limit = Math.min(options.limit || 50, 100);

  // Use raw SQL for full-text search
  const rows = await db.execute(
    rawSql`
      SELECT * FROM public.mailbox_messages
      WHERE recipient = ${recipient}
        AND to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
            @@ plainto_tsquery('english', ${query})
      ORDER BY created_at DESC
      LIMIT ${limit}
    `,
  );

  return rows as unknown as MailboxMessage[];
}

export async function replyToMessage(
  sender: string,
  originalMessageId: number,
  body: string,
): Promise<MailboxMessage | null> {
  // Get the original message to find the recipient (which becomes our recipient)
  const [original] = await db
    .select()
    .from(mailboxMessages)
    .where(eq(mailboxMessages.id, originalMessageId));

  if (!original) return null;

  // Sender of the reply must be the recipient of the original
  if (original.recipient !== sender) return null;

  const [row] = await db
    .insert(mailboxMessages)
    .values({
      recipient: original.sender,
      sender,
      title: `Re: ${original.title}`,
      body,
      replyToMessageId: originalMessageId,
      threadId: original.threadId || originalMessageId.toString(),
    })
    .returning();

  return row;
}

export async function getUnreadCounts(): Promise<Record<string, number>> {
  const rows = await db.execute(
    rawSql`
      SELECT recipient, COUNT(*) as count
      FROM public.mailbox_messages
      WHERE status = 'unread'
      GROUP BY recipient
    `,
  );

  const counts: Record<string, number> = {};
  for (const row of rows as unknown as Array<{
    recipient: string;
    count: string;
  }>) {
    counts[row.recipient] = Number(row.count);
  }
  return counts;
}

// Response waiting
export async function markWaiting(
  messageId: number,
  responder: string,
): Promise<MailboxMessage | null> {
  const [row] = await db
    .update(mailboxMessages)
    .set({
      responseWaiting: true,
      waitingResponder: responder,
      waitingSince: new Date(),
    })
    .where(eq(mailboxMessages.id, messageId))
    .returning();

  return row || null;
}

export async function clearWaiting(
  messageId: number,
): Promise<MailboxMessage | null> {
  const [row] = await db
    .update(mailboxMessages)
    .set({
      responseWaiting: false,
      waitingResponder: null,
      waitingSince: null,
    })
    .where(eq(mailboxMessages.id, messageId))
    .returning();

  return row || null;
}

export async function listMyWaiting(
  responder: string,
): Promise<MailboxMessage[]> {
  return db
    .select()
    .from(mailboxMessages)
    .where(
      and(
        eq(mailboxMessages.responseWaiting, true),
        eq(mailboxMessages.waitingResponder, responder),
      ),
    )
    .orderBy(asc(mailboxMessages.waitingSince));
}

export async function listWaitingOnOthers(
  sender: string,
): Promise<MailboxMessage[]> {
  return db
    .select()
    .from(mailboxMessages)
    .where(
      and(
        eq(mailboxMessages.responseWaiting, true),
        eq(mailboxMessages.sender, sender),
      ),
    )
    .orderBy(asc(mailboxMessages.waitingSince));
}
