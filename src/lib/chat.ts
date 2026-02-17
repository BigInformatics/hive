import { and, desc, eq, inArray, isNull, sql as rawSql, gt } from "drizzle-orm";
import { db } from "@/db";
import { chatChannels, chatMembers, chatMessages } from "@/db/schema";

/** Find an existing DM channel between exactly these two identities */
export async function findDmChannel(
  identity1: string,
  identity2: string,
): Promise<string | null> {
  const rows = await db.execute(rawSql`
    SELECT c.id FROM chat_channels c
    WHERE c.type = 'dm'
      AND (SELECT count(*) FROM chat_members m WHERE m.channel_id = c.id) = 2
      AND EXISTS (SELECT 1 FROM chat_members m WHERE m.channel_id = c.id AND m.identity = ${identity1})
      AND EXISTS (SELECT 1 FROM chat_members m WHERE m.channel_id = c.id AND m.identity = ${identity2})
    LIMIT 1
  `);
  const result = rows as unknown as Array<{ id: string }>;
  return result[0]?.id || null;
}

/** Find or create a DM channel */
export async function getOrCreateDm(
  identity1: string,
  identity2: string,
): Promise<string> {
  const existing = await findDmChannel(identity1, identity2);
  if (existing) return existing;

  const [channel] = await db
    .insert(chatChannels)
    .values({ type: "dm", createdBy: identity1 })
    .returning();

  await db.insert(chatMembers).values([
    { channelId: channel.id, identity: identity1 },
    { channelId: channel.id, identity: identity2 },
  ]);

  return channel.id;
}

/** Create a group chat */
export async function createGroupChannel(
  name: string,
  createdBy: string,
  members: string[],
): Promise<string> {
  const allMembers = [...new Set([createdBy, ...members])];

  const [channel] = await db
    .insert(chatChannels)
    .values({ type: "group", name, createdBy })
    .returning();

  await db.insert(chatMembers).values(
    allMembers.map((identity) => ({ channelId: channel.id, identity })),
  );

  return channel.id;
}

/** List channels for a user with last message and unread count */
export async function listChannels(identity: string) {
  const rows = await db.execute(rawSql`
    SELECT 
      c.id,
      c.type,
      c.name,
      c.created_by,
      c.created_at,
      m.last_read_at,
      (
        SELECT json_agg(json_build_object('identity', cm.identity))
        FROM chat_members cm WHERE cm.channel_id = c.id
      ) as members,
      (
        SELECT json_build_object(
          'id', lm.id, 'sender', lm.sender, 'body', lm.body, 'created_at', lm.created_at
        )
        FROM chat_messages lm 
        WHERE lm.channel_id = c.id AND lm.deleted_at IS NULL
        ORDER BY lm.created_at DESC LIMIT 1
      ) as last_message,
      (
        SELECT count(*)::int 
        FROM chat_messages um 
        WHERE um.channel_id = c.id 
          AND um.deleted_at IS NULL
          AND um.sender != ${identity}
          AND (m.last_read_at IS NULL OR um.created_at > m.last_read_at)
      ) as unread_count
    FROM chat_channels c
    JOIN chat_members m ON m.channel_id = c.id AND m.identity = ${identity}
    ORDER BY (
      SELECT max(cm2.created_at) FROM chat_messages cm2 WHERE cm2.channel_id = c.id
    ) DESC NULLS LAST
  `);

  return rows as unknown as Array<{
    id: string;
    type: string;
    name: string | null;
    created_by: string;
    created_at: string;
    last_read_at: string | null;
    members: Array<{ identity: string }>;
    last_message: {
      id: number;
      sender: string;
      body: string;
      created_at: string;
    } | null;
    unread_count: number;
  }>;
}

/** Get messages for a channel */
export async function getMessages(
  channelId: string,
  options: { limit?: number; before?: number } = {},
) {
  const limit = Math.min(options.limit || 50, 100);
  const conditions = [
    eq(chatMessages.channelId, channelId),
    isNull(chatMessages.deletedAt),
  ];

  if (options.before) {
    conditions.push(
      rawSql`${chatMessages.id} < ${options.before}` as any,
    );
  }

  return db
    .select()
    .from(chatMessages)
    .where(and(...conditions))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);
}

/** Send a message */
export async function sendChatMessage(
  channelId: string,
  sender: string,
  body: string,
) {
  const [msg] = await db
    .insert(chatMessages)
    .values({ channelId, sender, body })
    .returning();
  return msg;
}

/** Mark channel as read */
export async function markChannelRead(channelId: string, identity: string) {
  await db
    .update(chatMembers)
    .set({ lastReadAt: new Date() })
    .where(
      and(
        eq(chatMembers.channelId, channelId),
        eq(chatMembers.identity, identity),
      ),
    );
}

/** Check if identity is a member of a channel */
export async function isMember(
  channelId: string,
  identity: string,
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(chatMembers)
    .where(
      and(
        eq(chatMembers.channelId, channelId),
        eq(chatMembers.identity, identity),
      ),
    )
    .limit(1);
  return !!row;
}

/** Search chat messages across all channels the user is a member of */
export async function searchChatMessages(
  identity: string,
  query: string,
  options: {
    limit?: number;
    channelId?: string;
    sender?: string;
    before?: string;
    after?: string;
  } = {},
) {
  const limit = Math.min(options.limit || 50, 100);

  // Build conditions array using Drizzle's sql template for safe parameterization
  const conditions = [
    rawSql`m.deleted_at IS NULL`,
    rawSql`EXISTS (SELECT 1 FROM chat_members cm WHERE cm.channel_id = m.channel_id AND cm.identity = ${identity})`,
  ];

  if (query) {
    conditions.push(rawSql`m.body ILIKE ${'%' + query + '%'}`);
  }
  if (options.channelId) {
    conditions.push(rawSql`m.channel_id = ${options.channelId}`);
  }
  if (options.sender) {
    conditions.push(rawSql`m.sender = ${options.sender}`);
  }
  if (options.after) {
    conditions.push(rawSql`m.created_at >= ${options.after}`);
  }
  if (options.before) {
    conditions.push(rawSql`m.created_at <= ${options.before}`);
  }

  // Join conditions with AND
  const where = rawSql.join(conditions, rawSql` AND `);

  const rows = await db.execute(rawSql`
    SELECT m.id, m.channel_id, m.sender, m.body, m.created_at,
           c.type as channel_type, c.name as channel_name
    FROM chat_messages m
    JOIN chat_channels c ON c.id = m.channel_id
    WHERE ${where}
    ORDER BY m.created_at DESC
    LIMIT ${limit}
  `);

  return rows as unknown as Array<{
    id: number;
    channel_id: string;
    sender: string;
    body: string;
    created_at: string;
    channel_type: string;
    channel_name: string | null;
  }>;
}

/** Get channel members */
export async function getChannelMembers(channelId: string): Promise<string[]> {
  const rows = await db
    .select({ identity: chatMembers.identity })
    .from(chatMembers)
    .where(eq(chatMembers.channelId, channelId));
  return rows.map((r) => r.identity);
}
