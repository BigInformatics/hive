// Mailbox API Server
import { healthCheck, close } from "./db/client";
import { 
  sendMessage, listMessages, getMessage, 
  ackMessage, ackMessages, searchMessages,
  isValidMailbox, type SendMessageInput 
} from "./db/messages";
import { authenticate, initFromEnv, type AuthContext } from "./middleware/auth";

const PORT = parseInt(process.env.PORT || "3100");

// Initialize auth tokens
initFromEnv();

// JSON response helpers
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

// Auth wrapper
function requireAuth(
  request: Request,
  handler: (auth: AuthContext, request: Request) => Promise<Response>
): Promise<Response> {
  const auth = authenticate(request);
  if (!auth) {
    return Promise.resolve(error("Unauthorized", 401));
  }
  return handler(auth, request);
}

// Route handlers
async function handleHealthz(): Promise<Response> {
  return json({ status: "ok" });
}

async function handleReadyz(): Promise<Response> {
  const dbOk = await healthCheck();
  if (!dbOk) {
    return json({ status: "error", db: false }, 503);
  }
  return json({ status: "ok", db: true });
}

async function handleSend(
  auth: AuthContext,
  recipient: string,
  request: Request
): Promise<Response> {
  if (!isValidMailbox(recipient)) {
    return error(`Invalid recipient: ${recipient}`, 400);
  }

  const body = await request.json() as Partial<SendMessageInput>;
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
    metadata: body.metadata,
  });

  return json({ message: serializeMessage(message) }, 201);
}

async function handleList(
  auth: AuthContext,
  request: Request
): Promise<Response> {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") as "unread" | "read" | null;
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const cursor = url.searchParams.get("cursor") || undefined;
  const sinceId = url.searchParams.get("sinceId");

  const result = await listMessages(auth.identity, {
    status: status || undefined,
    limit,
    cursor,
    sinceId: sinceId ? BigInt(sinceId) : undefined,
  });

  return json({
    messages: result.messages.map(serializeMessage),
    nextCursor: result.nextCursor,
  });
}

async function handleGet(
  auth: AuthContext,
  id: string
): Promise<Response> {
  const message = await getMessage(auth.identity, BigInt(id));
  if (!message) {
    return error("Message not found", 404);
  }
  return json({ message: serializeMessage(message) });
}

async function handleAck(
  auth: AuthContext,
  id: string
): Promise<Response> {
  const message = await ackMessage(auth.identity, BigInt(id));
  if (!message) {
    return error("Message not found", 404);
  }
  return json({ message: serializeMessage(message) });
}

async function handleBatchAck(
  auth: AuthContext,
  request: Request
): Promise<Response> {
  const body = await request.json() as { ids?: (string | number)[] };
  if (!body.ids || !Array.isArray(body.ids)) {
    return error("ids array is required", 400);
  }

  const ids = body.ids.map(id => BigInt(id));
  const result = await ackMessages(auth.identity, ids);

  return json({
    success: result.success.map(String),
    notFound: result.notFound.map(String),
  });
}

async function handleReply(
  auth: AuthContext,
  id: string,
  request: Request
): Promise<Response> {
  // Get original message
  const original = await getMessage(auth.identity, BigInt(id));
  if (!original) {
    return error("Original message not found", 404);
  }

  const body = await request.json() as Partial<SendMessageInput>;
  if (!body.body && !body.title) {
    return error("title or body is required", 400);
  }

  // Reply goes to the original sender
  const message = await sendMessage({
    recipient: original.sender,
    sender: auth.identity,
    title: body.title || `Re: ${original.title}`,
    body: body.body,
    urgent: body.urgent,
    threadId: original.threadId || original.id.toString(),
    replyToMessageId: original.id,
    dedupeKey: body.dedupeKey,
    metadata: body.metadata,
  });

  return json({ message: serializeMessage(message) }, 201);
}

async function handleSearch(
  auth: AuthContext,
  request: Request
): Promise<Response> {
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
    limit,
  });

  return json({ messages: messages.map(serializeMessage) });
}

// Serialize bigint to string for JSON
function serializeMessage(msg: {
  id: bigint;
  recipient: string;
  sender: string;
  title: string;
  body: string | null;
  status: string;
  urgent: boolean;
  createdAt: Date;
  viewedAt: Date | null;
  threadId: string | null;
  replyToMessageId: bigint | null;
  dedupeKey: string | null;
  metadata: Record<string, unknown> | null;
}) {
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
    metadata: msg.metadata,
  };
}

// Main request handler
async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname;

  // Health endpoints (no auth)
  if (path === "/healthz") return handleHealthz();
  if (path === "/readyz") return handleReadyz();

  // API routes
  const mailboxMatch = path.match(/^\/mailboxes\/([^/]+)\/messages\/?$/);
  const messageMatch = path.match(/^\/mailboxes\/me\/messages\/(\d+)$/);
  const ackMatch = path.match(/^\/mailboxes\/me\/messages\/(\d+)\/ack$/);
  const replyMatch = path.match(/^\/mailboxes\/me\/messages\/(\d+)\/reply$/);

  // POST /mailboxes/{recipient}/messages - Send message
  if (method === "POST" && mailboxMatch && mailboxMatch[1] !== "me") {
    return requireAuth(request, (auth) => handleSend(auth, mailboxMatch[1], request));
  }

  // GET /mailboxes/me/messages - List messages
  if (method === "GET" && path === "/mailboxes/me/messages") {
    return requireAuth(request, handleList);
  }

  // GET /mailboxes/me/messages/search - Search messages
  if (method === "GET" && path === "/mailboxes/me/messages/search") {
    return requireAuth(request, handleSearch);
  }

  // GET /mailboxes/me/messages/{id} - Get single message
  if (method === "GET" && messageMatch) {
    return requireAuth(request, (auth) => handleGet(auth, messageMatch[1]));
  }

  // POST /mailboxes/me/messages/{id}/ack - Ack single message
  if (method === "POST" && ackMatch) {
    return requireAuth(request, (auth) => handleAck(auth, ackMatch[1]));
  }

  // POST /mailboxes/me/messages/ack - Batch ack
  if (method === "POST" && path === "/mailboxes/me/messages/ack") {
    return requireAuth(request, handleBatchAck);
  }

  // POST /mailboxes/me/messages/{id}/reply - Reply
  if (method === "POST" && replyMatch) {
    return requireAuth(request, (auth) => handleReply(auth, replyMatch[1], request));
  }

  return error("Not found", 404);
}

// Start server
const server = Bun.serve({
  port: PORT,
  fetch: handleRequest,
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

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n[mailbox-api] Shutting down...");
  await close();
  process.exit(0);
});
