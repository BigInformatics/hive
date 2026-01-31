// Message repository
import { sql } from "./client";

export interface Message {
  id: bigint;
  recipient: string;
  sender: string;
  title: string;
  body: string | null;
  status: "unread" | "read";
  urgent: boolean;
  createdAt: Date;
  viewedAt: Date | null;
  threadId: string | null;
  replyToMessageId: bigint | null;
  dedupeKey: string | null;
  metadata: Record<string, unknown> | null;
  responsePending: boolean;
  pendingResponder: string | null;
  pendingSince: Date | null;
}

export interface SendMessageInput {
  recipient: string;
  sender: string;
  title: string;
  body?: string;
  urgent?: boolean;
  threadId?: string;
  replyToMessageId?: bigint;
  dedupeKey?: string;
  metadata?: Record<string, unknown>;
}

// Allowlist of valid mailboxes
const VALID_MAILBOXES = new Set(["chris", "clio", "domingo", "zumie"]);

export function isValidMailbox(name: string): boolean {
  return VALID_MAILBOXES.has(name);
}

export async function sendMessage(input: SendMessageInput): Promise<Message> {
  // Use INSERT...ON CONFLICT for race-safe idempotency when dedupeKey is provided
  if (input.dedupeKey) {
    const [row] = await sql`
      INSERT INTO public.mailbox_messages 
        (recipient, sender, title, body, urgent, thread_id, reply_to_message_id, dedupe_key, metadata)
      VALUES 
        (${input.recipient}, ${input.sender}, ${input.title}, ${input.body || null}, 
         ${input.urgent || false}, ${input.threadId || null}, 
         ${input.replyToMessageId || null}, ${input.dedupeKey}, 
         ${input.metadata ? JSON.stringify(input.metadata) : null})
      ON CONFLICT (sender, recipient, dedupe_key) WHERE dedupe_key IS NOT NULL
      DO UPDATE SET id = public.mailbox_messages.id
      RETURNING *
    `;
    return rowToMessage(row);
  }

  // No dedupeKey - normal insert
  const [row] = await sql`
    INSERT INTO public.mailbox_messages 
      (recipient, sender, title, body, urgent, thread_id, reply_to_message_id, metadata)
    VALUES 
      (${input.recipient}, ${input.sender}, ${input.title}, ${input.body || null}, 
       ${input.urgent || false}, ${input.threadId || null}, 
       ${input.replyToMessageId || null},
       ${input.metadata ? JSON.stringify(input.metadata) : null})
    RETURNING *
  `;
  return rowToMessage(row);
}

export interface ListOptions {
  status?: "unread" | "read";
  limit?: number;
  sinceId?: bigint;
  cursor?: string;
}

export async function listMessages(
  recipient: string,
  options: ListOptions = {}
): Promise<{ messages: Message[]; nextCursor?: string }> {
  const limit = Math.min(options.limit || 50, 100);
  const sinceId = options.sinceId || (options.cursor ? BigInt(options.cursor) : null);

  let rows;
  if (options.status === "unread") {
    // Optimized unread query: urgent first, then oldest
    rows = sinceId
      ? await sql`
          SELECT * FROM public.mailbox_messages 
          WHERE recipient = ${recipient} 
            AND status = 'unread'
            AND id > ${sinceId}
          ORDER BY urgent DESC, created_at ASC
          LIMIT ${limit + 1}
        `
      : await sql`
          SELECT * FROM public.mailbox_messages 
          WHERE recipient = ${recipient} AND status = 'unread'
          ORDER BY urgent DESC, created_at ASC
          LIMIT ${limit + 1}
        `;
  } else if (options.status === "read") {
    rows = sinceId
      ? await sql`
          SELECT * FROM public.mailbox_messages 
          WHERE recipient = ${recipient} 
            AND status = 'read'
            AND id > ${sinceId}
          ORDER BY created_at DESC
          LIMIT ${limit + 1}
        `
      : await sql`
          SELECT * FROM public.mailbox_messages 
          WHERE recipient = ${recipient} AND status = 'read'
          ORDER BY created_at DESC
          LIMIT ${limit + 1}
        `;
  } else {
    rows = sinceId
      ? await sql`
          SELECT * FROM public.mailbox_messages 
          WHERE recipient = ${recipient} AND id > ${sinceId}
          ORDER BY created_at DESC
          LIMIT ${limit + 1}
        `
      : await sql`
          SELECT * FROM public.mailbox_messages 
          WHERE recipient = ${recipient}
          ORDER BY created_at DESC
          LIMIT ${limit + 1}
        `;
  }

  const hasMore = rows.length > limit;
  const messages = rows.slice(0, limit).map(rowToMessage);
  const nextCursor = hasMore && messages.length > 0 
    ? messages[messages.length - 1].id.toString() 
    : undefined;

  return { messages, nextCursor };
}

export async function getMessage(recipient: string, id: bigint): Promise<Message | null> {
  const [row] = await sql`
    SELECT * FROM public.mailbox_messages 
    WHERE recipient = ${recipient} AND id = ${id}
  `;
  return row ? rowToMessage(row) : null;
}

export async function ackMessage(recipient: string, id: bigint): Promise<Message | null> {
  const [row] = await sql`
    UPDATE public.mailbox_messages 
    SET status = 'read', viewed_at = COALESCE(viewed_at, NOW())
    WHERE recipient = ${recipient} AND id = ${id}
    RETURNING *
  `;
  return row ? rowToMessage(row) : null;
}

export async function ackMessages(
  recipient: string, 
  ids: bigint[]
): Promise<{ success: bigint[]; notFound: bigint[] }> {
  if (ids.length === 0) return { success: [], notFound: [] };

  // Ack each message individually (safer than array syntax)
  const results = await Promise.all(
    ids.map(id => ackMessage(recipient, id))
  );
  
  const success: bigint[] = [];
  const notFound: bigint[] = [];
  
  for (let i = 0; i < ids.length; i++) {
    if (results[i]) {
      success.push(ids[i]);
    } else {
      notFound.push(ids[i]);
    }
  }
  
  return { success, notFound };
}

export async function searchMessages(
  recipient: string,
  query: string,
  options: { from?: Date; to?: Date; limit?: number } = {}
): Promise<Message[]> {
  const limit = Math.min(options.limit || 50, 100);
  
  let rows;
  if (options.from && options.to) {
    rows = await sql`
      SELECT * FROM public.mailbox_messages 
      WHERE recipient = ${recipient}
        AND to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, '')) @@ plainto_tsquery('english', ${query})
        AND created_at >= ${options.from}
        AND created_at <= ${options.to}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  } else if (options.from) {
    rows = await sql`
      SELECT * FROM public.mailbox_messages 
      WHERE recipient = ${recipient}
        AND to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, '')) @@ plainto_tsquery('english', ${query})
        AND created_at >= ${options.from}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  } else if (options.to) {
    rows = await sql`
      SELECT * FROM public.mailbox_messages 
      WHERE recipient = ${recipient}
        AND to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, '')) @@ plainto_tsquery('english', ${query})
        AND created_at <= ${options.to}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  } else {
    rows = await sql`
      SELECT * FROM public.mailbox_messages 
      WHERE recipient = ${recipient}
        AND to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, '')) @@ plainto_tsquery('english', ${query})
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  }
  
  return rows.map(rowToMessage);
}

function rowToMessage(row: Record<string, unknown>): Message {
  return {
    id: row.id as bigint,
    recipient: row.recipient as string,
    sender: row.sender as string,
    title: row.title as string,
    body: row.body as string | null,
    status: row.status as "unread" | "read",
    urgent: row.urgent as boolean,
    createdAt: row.created_at as Date,
    viewedAt: row.viewed_at as Date | null,
    threadId: row.thread_id as string | null,
    replyToMessageId: row.reply_to_message_id as bigint | null,
    dedupeKey: row.dedupe_key as string | null,
    metadata: row.metadata as Record<string, unknown> | null,
    responsePending: row.response_pending as boolean ?? false,
    pendingResponder: row.pending_responder as string | null,
    pendingSince: row.pending_since as Date | null,
  };
}

// UI endpoint: list all messages across all mailboxes (no auth, internal only)
export async function listAllMessages(options: { 
  limit?: number; 
  recipient?: string;
  sinceId?: bigint;
} = {}): Promise<Message[]> {
  const limit = Math.min(options.limit || 50, 100);
  
  let rows;
  if (options.recipient && options.sinceId) {
    rows = await sql`
      SELECT * FROM public.mailbox_messages 
      WHERE recipient = ${options.recipient} AND id > ${options.sinceId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  } else if (options.recipient) {
    rows = await sql`
      SELECT * FROM public.mailbox_messages 
      WHERE recipient = ${options.recipient}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  } else if (options.sinceId) {
    rows = await sql`
      SELECT * FROM public.mailbox_messages 
      WHERE id > ${options.sinceId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  } else {
    rows = await sql`
      SELECT * FROM public.mailbox_messages 
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  }
  
  return rows.map(rowToMessage);
}

// Get unread message counts for all users
export async function getUnreadCounts(): Promise<Record<string, number>> {
  const rows = await sql`
    SELECT recipient, COUNT(*) as count
    FROM public.mailbox_messages
    WHERE status = 'unread'
    GROUP BY recipient
  `;
  
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.recipient as string] = Number(row.count);
  }
  return counts;
}

// ============================================================
// RESPONSE PENDING TRACKING
// ============================================================

/**
 * Mark a message as having a pending response from the given responder.
 * Used when replying to a message with a promise to do something.
 */
export async function markPending(messageId: bigint, responder: string): Promise<Message | null> {
  const [row] = await sql`
    UPDATE public.mailbox_messages 
    SET response_pending = true,
        pending_responder = ${responder},
        pending_since = NOW()
    WHERE id = ${messageId}
    RETURNING *
  `;
  return row ? rowToMessage(row) : null;
}

/**
 * Clear the pending flag on a message (task completed).
 */
export async function clearPending(messageId: bigint): Promise<Message | null> {
  const [row] = await sql`
    UPDATE public.mailbox_messages 
    SET response_pending = false,
        pending_responder = NULL,
        pending_since = NULL
    WHERE id = ${messageId}
    RETURNING *
  `;
  return row ? rowToMessage(row) : null;
}

/**
 * List all messages where the given user has made a pending promise.
 * These are tasks you've committed to but not yet completed.
 */
export async function listMyPendingPromises(responder: string): Promise<Message[]> {
  const rows = await sql`
    SELECT * FROM public.mailbox_messages 
    WHERE response_pending = true 
      AND pending_responder = ${responder}
    ORDER BY pending_since ASC
  `;
  return rows.map(rowToMessage);
}

/**
 * List all messages sent by the given user that are awaiting a response.
 * These are tasks you're waiting on someone else to complete.
 */
export async function listAwaitingResponse(sender: string): Promise<Message[]> {
  const rows = await sql`
    SELECT * FROM public.mailbox_messages 
    WHERE response_pending = true 
      AND sender = ${sender}
    ORDER BY pending_since ASC
  `;
  return rows.map(rowToMessage);
}

/**
 * Get pending counts: how many promises each user has outstanding.
 */
export async function getPendingCounts(): Promise<Record<string, number>> {
  const rows = await sql`
    SELECT pending_responder, COUNT(*) as count
    FROM public.mailbox_messages
    WHERE response_pending = true AND pending_responder IS NOT NULL
    GROUP BY pending_responder
  `;
  
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.pending_responder as string] = Number(row.count);
  }
  return counts;
}
