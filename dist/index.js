// @bun
// src/db/client.ts
var {SQL } = globalThis.Bun;
var connectionString = process.env.DATABASE_URL || `postgres://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE_TEAM}`;
var sql = new SQL({ url: connectionString });
async function healthCheck() {
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
async function close() {
  await sql.close();
}

// src/db/messages.ts
var VALID_MAILBOXES = new Set(["chris", "clio", "domingo", "zumie"]);
function isValidMailbox(name) {
  return VALID_MAILBOXES.has(name);
}
async function sendMessage(input) {
  if (input.dedupeKey) {
    const existing = await sql`
      SELECT * FROM public.mailbox_messages 
      WHERE sender = ${input.sender} 
        AND recipient = ${input.recipient} 
        AND dedupe_key = ${input.dedupeKey}
      LIMIT 1
    `;
    if (existing.length > 0) {
      return rowToMessage(existing[0]);
    }
  }
  const [row] = await sql`
    INSERT INTO public.mailbox_messages 
      (recipient, sender, title, body, urgent, thread_id, reply_to_message_id, dedupe_key, metadata)
    VALUES 
      (${input.recipient}, ${input.sender}, ${input.title}, ${input.body || null}, 
       ${input.urgent || false}, ${input.threadId || null}, 
       ${input.replyToMessageId || null}, ${input.dedupeKey || null}, 
       ${input.metadata ? JSON.stringify(input.metadata) : null})
    RETURNING *
  `;
  return rowToMessage(row);
}
async function listMessages(recipient, options = {}) {
  const limit = Math.min(options.limit || 50, 100);
  const sinceId = options.sinceId || (options.cursor ? BigInt(options.cursor) : null);
  let rows;
  if (options.status === "unread") {
    rows = sinceId ? await sql`
          SELECT * FROM public.mailbox_messages 
          WHERE recipient = ${recipient} 
            AND status = 'unread'
            AND id > ${sinceId}
          ORDER BY urgent DESC, created_at ASC
          LIMIT ${limit + 1}
        ` : await sql`
          SELECT * FROM public.mailbox_messages 
          WHERE recipient = ${recipient} AND status = 'unread'
          ORDER BY urgent DESC, created_at ASC
          LIMIT ${limit + 1}
        `;
  } else if (options.status === "read") {
    rows = sinceId ? await sql`
          SELECT * FROM public.mailbox_messages 
          WHERE recipient = ${recipient} 
            AND status = 'read'
            AND id > ${sinceId}
          ORDER BY created_at DESC
          LIMIT ${limit + 1}
        ` : await sql`
          SELECT * FROM public.mailbox_messages 
          WHERE recipient = ${recipient} AND status = 'read'
          ORDER BY created_at DESC
          LIMIT ${limit + 1}
        `;
  } else {
    rows = sinceId ? await sql`
          SELECT * FROM public.mailbox_messages 
          WHERE recipient = ${recipient} AND id > ${sinceId}
          ORDER BY created_at DESC
          LIMIT ${limit + 1}
        ` : await sql`
          SELECT * FROM public.mailbox_messages 
          WHERE recipient = ${recipient}
          ORDER BY created_at DESC
          LIMIT ${limit + 1}
        `;
  }
  const hasMore = rows.length > limit;
  const messages = rows.slice(0, limit).map(rowToMessage);
  const nextCursor = hasMore && messages.length > 0 ? messages[messages.length - 1].id.toString() : undefined;
  return { messages, nextCursor };
}
async function getMessage(recipient, id) {
  const [row] = await sql`
    SELECT * FROM public.mailbox_messages 
    WHERE recipient = ${recipient} AND id = ${id}
  `;
  return row ? rowToMessage(row) : null;
}
async function ackMessage(recipient, id) {
  const [row] = await sql`
    UPDATE public.mailbox_messages 
    SET status = 'read', viewed_at = COALESCE(viewed_at, NOW())
    WHERE recipient = ${recipient} AND id = ${id}
    RETURNING *
  `;
  return row ? rowToMessage(row) : null;
}
async function ackMessages(recipient, ids) {
  if (ids.length === 0)
    return { success: [], notFound: [] };
  const updated = await sql`
    UPDATE public.mailbox_messages 
    SET status = 'read', viewed_at = COALESCE(viewed_at, NOW())
    WHERE recipient = ${recipient} AND id = ANY(${ids}::bigint[])
    RETURNING id
  `;
  const successIds = new Set(updated.map((r) => r.id.toString()));
  const success = ids.filter((id) => successIds.has(id.toString()));
  const notFound = ids.filter((id) => !successIds.has(id.toString()));
  return { success, notFound };
}
async function searchMessages(recipient, query, options = {}) {
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
function rowToMessage(row) {
  return {
    id: row.id,
    recipient: row.recipient,
    sender: row.sender,
    title: row.title,
    body: row.body,
    status: row.status,
    urgent: row.urgent,
    createdAt: row.created_at,
    viewedAt: row.viewed_at,
    threadId: row.thread_id,
    replyToMessageId: row.reply_to_message_id,
    dedupeKey: row.dedupe_key,
    metadata: row.metadata
  };
}

// src/middleware/auth.ts
var tokens = new Map;
function loadTokens(config) {
  tokens.clear();
  for (const [token, info] of Object.entries(config)) {
    tokens.set(token, { identity: info.identity, isAdmin: info.admin || false });
  }
}
function authenticate(request) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.slice(7);
  return tokens.get(token) || null;
}
function initFromEnv() {
  const config = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("MAILBOX_TOKEN_") && value) {
      const name = key.slice(14).toLowerCase();
      config[value] = { identity: name, admin: key.endsWith("_ADMIN") };
    }
  }
  if (process.env.MAILBOX_ADMIN_TOKEN) {
    config[process.env.MAILBOX_ADMIN_TOKEN] = { identity: "admin", isAdmin: true };
  }
  loadTokens(config);
  console.log(`[auth] Loaded ${tokens.size} token(s)`);
}

// src/index.ts
var PORT = parseInt(process.env.PORT || "3100");
initFromEnv();
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
function error(message, status = 400) {
  return json({ error: message }, status);
}
function requireAuth(request, handler) {
  const auth = authenticate(request);
  if (!auth) {
    return Promise.resolve(error("Unauthorized", 401));
  }
  return handler(auth, request);
}
async function handleHealthz() {
  return json({ status: "ok" });
}
async function handleReadyz() {
  const dbOk = await healthCheck();
  if (!dbOk) {
    return json({ status: "error", db: false }, 503);
  }
  return json({ status: "ok", db: true });
}
async function handleSend(auth, recipient, request) {
  if (!isValidMailbox(recipient)) {
    return error(`Invalid recipient: ${recipient}`, 400);
  }
  const body = await request.json();
  if (!body.title) {
    return error("title is required", 400);
  }
  const message = await sendMessage({
    recipient,
    sender: auth.identity,
    title: body.title,
    body: body.body,
    urgent: body.urgent,
    threadId: body.threadId,
    replyToMessageId: body.replyToMessageId ? BigInt(body.replyToMessageId) : undefined,
    dedupeKey: body.dedupeKey,
    metadata: body.metadata
  });
  return json({ message: serializeMessage(message) }, 201);
}
async function handleList(auth, request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const cursor = url.searchParams.get("cursor") || undefined;
  const sinceId = url.searchParams.get("sinceId");
  const result = await listMessages(auth.identity, {
    status: status || undefined,
    limit,
    cursor,
    sinceId: sinceId ? BigInt(sinceId) : undefined
  });
  return json({
    messages: result.messages.map(serializeMessage),
    nextCursor: result.nextCursor
  });
}
async function handleGet(auth, id) {
  const message = await getMessage(auth.identity, BigInt(id));
  if (!message) {
    return error("Message not found", 404);
  }
  return json({ message: serializeMessage(message) });
}
async function handleAck(auth, id) {
  const message = await ackMessage(auth.identity, BigInt(id));
  if (!message) {
    return error("Message not found", 404);
  }
  return json({ message: serializeMessage(message) });
}
async function handleBatchAck(auth, request) {
  const body = await request.json();
  if (!body.ids || !Array.isArray(body.ids)) {
    return error("ids array is required", 400);
  }
  const ids = body.ids.map((id) => BigInt(id));
  const result = await ackMessages(auth.identity, ids);
  return json({
    success: result.success.map(String),
    notFound: result.notFound.map(String)
  });
}
async function handleReply(auth, id, request) {
  const original = await getMessage(auth.identity, BigInt(id));
  if (!original) {
    return error("Original message not found", 404);
  }
  const body = await request.json();
  if (!body.body && !body.title) {
    return error("title or body is required", 400);
  }
  const message = await sendMessage({
    recipient: original.sender,
    sender: auth.identity,
    title: body.title || `Re: ${original.title}`,
    body: body.body,
    urgent: body.urgent,
    threadId: original.threadId || original.id.toString(),
    replyToMessageId: original.id,
    dedupeKey: body.dedupeKey,
    metadata: body.metadata
  });
  return json({ message: serializeMessage(message) }, 201);
}
async function handleSearch(auth, request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q");
  if (!query) {
    return error("q (query) parameter is required", 400);
  }
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const messages = await searchMessages(auth.identity, query, {
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
    limit
  });
  return json({ messages: messages.map(serializeMessage) });
}
function serializeMessage(msg) {
  return {
    id: msg.id.toString(),
    recipient: msg.recipient,
    sender: msg.sender,
    title: msg.title,
    body: msg.body,
    status: msg.status,
    urgent: msg.urgent,
    createdAt: msg.createdAt.toISOString(),
    viewedAt: msg.viewedAt?.toISOString() || null,
    threadId: msg.threadId,
    replyToMessageId: msg.replyToMessageId?.toString() || null,
    dedupeKey: msg.dedupeKey,
    metadata: msg.metadata
  };
}
async function handleRequest(request) {
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname;
  if (path === "/healthz")
    return handleHealthz();
  if (path === "/readyz")
    return handleReadyz();
  const mailboxMatch = path.match(/^\/mailboxes\/([^/]+)\/messages\/?$/);
  const messageMatch = path.match(/^\/mailboxes\/me\/messages\/(\d+)$/);
  const ackMatch = path.match(/^\/mailboxes\/me\/messages\/(\d+)\/ack$/);
  const replyMatch = path.match(/^\/mailboxes\/me\/messages\/(\d+)\/reply$/);
  if (method === "POST" && mailboxMatch && mailboxMatch[1] !== "me") {
    return requireAuth(request, (auth) => handleSend(auth, mailboxMatch[1], request));
  }
  if (method === "GET" && path === "/mailboxes/me/messages") {
    return requireAuth(request, handleList);
  }
  if (method === "GET" && path === "/mailboxes/me/messages/search") {
    return requireAuth(request, handleSearch);
  }
  if (method === "GET" && messageMatch) {
    return requireAuth(request, (auth) => handleGet(auth, messageMatch[1]));
  }
  if (method === "POST" && ackMatch) {
    return requireAuth(request, (auth) => handleAck(auth, ackMatch[1]));
  }
  if (method === "POST" && path === "/mailboxes/me/messages/ack") {
    return requireAuth(request, handleBatchAck);
  }
  if (method === "POST" && replyMatch) {
    return requireAuth(request, (auth) => handleReply(auth, replyMatch[1], request));
  }
  return error("Not found", 404);
}
var server = Bun.serve({
  port: PORT,
  fetch: handleRequest
});
console.log(`[mailbox-api] Listening on http://localhost:${PORT}`);
console.log(`[mailbox-api] Endpoints:`);
console.log(`  GET  /healthz`);
console.log(`  GET  /readyz`);
console.log(`  POST /mailboxes/{recipient}/messages`);
console.log(`  GET  /mailboxes/me/messages`);
console.log(`  GET  /mailboxes/me/messages/search?q=...`);
console.log(`  GET  /mailboxes/me/messages/{id}`);
console.log(`  POST /mailboxes/me/messages/{id}/ack`);
console.log(`  POST /mailboxes/me/messages/ack`);
console.log(`  POST /mailboxes/me/messages/{id}/reply`);
process.on("SIGINT", async () => {
  console.log(`
[mailbox-api] Shutting down...`);
  await close();
  process.exit(0);
});
