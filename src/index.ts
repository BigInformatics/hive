// Hive - Team Communication Hub
import { healthCheck, close } from "./db/client";
import { 
  sendMessage, listMessages, getMessage, 
  ackMessage, ackMessages, searchMessages,
  isValidMailbox, listAllMessages, getUnreadCounts,
  markWaiting, clearWaiting, listMyWaiting, 
  listWaitingOnOthers, getWaitingCounts,
  type SendMessageInput 
} from "./db/messages";
import { authenticate, initFromEnv, type AuthContext } from "./middleware/auth";
import { subscribe, emit, type MailboxEvent } from "./events";
import * as broadcast from "./db/broadcast";
import * as swarm from "./db/swarm";

// ============================================================
// SWARM BUZZ INTEGRATION
// ============================================================

type SwarmBuzzEventType = 
  | 'swarm.task.created' 
  | 'swarm.task.updated' 
  | 'swarm.task.status_changed'
  | 'swarm.task.assigned'
  | 'swarm.task.reordered'
  | 'swarm.task.completed'
  | 'swarm.project.created'
  | 'swarm.project.updated'
  | 'swarm.project.archived';

interface SwarmBuzzPayload {
  eventType: SwarmBuzzEventType;
  taskId?: string;
  projectId?: string;
  title: string;
  actor: string;
  assignee?: string | null;
  status?: swarm.TaskStatus;
  diffSummary?: string;
  deepLink: string;
}

// Broadcast listeners for real-time Buzz updates
let swarmBuzzListenerCallback: ((event: broadcast.BroadcastEvent) => void) | null = null;

function setSwarmBuzzListener(callback: (event: broadcast.BroadcastEvent) => void): void {
  swarmBuzzListenerCallback = callback;
}

/**
 * Emit a Swarm event to the Buzz feed.
 * Deep-links point to the keyed Swarm UI (using first available key for now).
 */
async function emitSwarmBuzz(payload: SwarmBuzzPayload): Promise<void> {
  try {
    const event = await broadcast.emitInternalEvent({
      appName: 'swarm',
      appTitle: 'Swarm Tasks',
      title: formatSwarmBuzzTitle(payload),
      body: {
        eventType: payload.eventType,
        taskId: payload.taskId,
        projectId: payload.projectId,
        title: payload.title,
        actor: payload.actor,
        assignee: payload.assignee,
        status: payload.status,
        diffSummary: payload.diffSummary,
        deepLink: payload.deepLink,
      },
    });
    
    // Broadcast to SSE listeners
    if (swarmBuzzListenerCallback) {
      swarmBuzzListenerCallback(event);
    }
    
    // Broadcast to Swarm SSE listeners
    for (const listener of swarmEventListeners) {
      try {
        listener({
          type: payload.eventType,
          taskId: payload.taskId,
          projectId: payload.projectId,
          actor: payload.actor,
        });
      } catch { /* listener may be closed */ }
    }
    
    console.log(`[swarm-buzz] Emitted ${payload.eventType}: ${payload.title}`);
  } catch (err) {
    console.error('[swarm-buzz] Failed to emit event:', err);
  }
}

function formatSwarmBuzzTitle(payload: SwarmBuzzPayload): string {
  switch (payload.eventType) {
    case 'swarm.task.created':
      return `${payload.actor} created task: ${payload.title}`;
    case 'swarm.task.updated':
      return `${payload.actor} updated task: ${payload.title}`;
    case 'swarm.task.status_changed':
      return `${payload.actor} changed "${payload.title}" to ${payload.status}`;
    case 'swarm.task.assigned':
      return `${payload.actor} assigned "${payload.title}" to ${payload.assignee || 'unassigned'}`;
    case 'swarm.task.reordered':
      return `${payload.actor} reordered "${payload.title}"`;
    case 'swarm.task.completed':
      return `${payload.actor} completed: ${payload.title}`;
    case 'swarm.project.created':
      return `${payload.actor} created project: ${payload.title}`;
    case 'swarm.project.updated':
      return `${payload.actor} updated project: ${payload.title}`;
    case 'swarm.project.archived':
      return `${payload.actor} archived project: ${payload.title}`;
    default:
      return `Swarm: ${payload.title}`;
  }
}

function getSwarmDeepLink(taskId?: string): string {
  // Use first available UI key for deep link, or fallback to public route
  const keys = Object.keys(uiMailboxKeys);
  const keyPath = keys.length > 0 ? `/${keys[0]}` : '';
  const base = `https://messages.biginformatics.net/ui${keyPath}/swarm`;
  return taskId ? `${base}?task=${taskId}` : base;
}

const PORT = parseInt(process.env.PORT || "3100");

// Initialize auth tokens
initFromEnv();

// UI mailbox keys config (for compose feature)
type UIKeyConfig = { sender: string; admin?: boolean };
const uiMailboxKeys: Record<string, UIKeyConfig> = {};

function initUIKeys() {
  // UI_MAILBOX_KEYS='{"key1":{"sender":"chris","admin":true},...}'
  const jsonKeys = process.env.UI_MAILBOX_KEYS;
  if (jsonKeys && jsonKeys !== "SET_ME") {
    try {
      const parsed = JSON.parse(jsonKeys);
      Object.assign(uiMailboxKeys, parsed);
      console.log(`[hive] Loaded ${Object.keys(uiMailboxKeys).length} UI mailbox keys`);
    } catch (e) {
      console.error("[hive] Failed to parse UI_MAILBOX_KEYS:", e);
    }
  } else {
    console.log(`[hive] UI_MAILBOX_KEYS not configured - compose UI disabled`);
  }
}

initUIKeys();

// ============================================================
// PRESENCE TRACKING
// ============================================================

// Track active connections: Map<connectionId, { user: string, connectedAt: Date }>
type PresenceEntry = { user: string; connectedAt: Date; type: 'ui' | 'api' };
const activeConnections = new Map<string, PresenceEntry>();
let connectionIdCounter = 0;

// Track last seen time for each user (persists after disconnect for fade effect)
const userLastSeen = new Map<string, number>(); // user -> timestamp

// Track last API activity for presence (5 min timeout)
const API_PRESENCE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const lastApiActivity = new Map<string, number>(); // user -> timestamp

// Presence change listeners (SSE controllers that want presence updates)
type PresenceListener = (event: { type: 'join' | 'leave'; user: string; presence: PresenceInfo[] }) => void;
const presenceListeners = new Set<PresenceListener>();

// Swarm event listeners (SSE controllers that want swarm updates)
type SwarmEventListener = (event: { type: string; taskId?: string; projectId?: string; actor?: string }) => void;
const swarmEventListeners = new Set<SwarmEventListener>();

type PresenceInfo = { user: string; online: boolean; lastSeen: number; unread: number; waiting: number };

function generateConnectionId(): string {
  return `conn_${++connectionIdCounter}_${Date.now()}`;
}

function getPresent(): string[] {
  const users = new Set<string>();
  // SSE connections
  for (const entry of activeConnections.values()) {
    users.add(entry.user);
  }
  // Recent API activity (within timeout)
  const now = Date.now();
  for (const [user, timestamp] of lastApiActivity) {
    if (now - timestamp < API_PRESENCE_TIMEOUT_MS) {
      users.add(user);
    }
  }
  return Array.from(users).sort();
}

async function getPresenceInfo(): Promise<PresenceInfo[]> {
  const allUsers = ['chris', 'clio', 'domingo', 'zumie'];
  const onlineUsers = getPresent();
  const now = Date.now();
  const unreadCounts = await getUnreadCounts();
  const waitingCounts = await getWaitingCounts();
  
  return allUsers.map(user => ({
    user,
    online: onlineUsers.includes(user),
    lastSeen: onlineUsers.includes(user) ? now : (userLastSeen.get(user) || 0),
    unread: unreadCounts[user] || 0,
    waiting: waitingCounts[user] || 0  // Tasks waiting on this user
  }));
}

async function addPresence(connId: string, user: string, type: 'ui' | 'api'): Promise<void> {
  const wasPresent = getPresent().includes(user);
  activeConnections.set(connId, { user, connectedAt: new Date(), type });
  userLastSeen.set(user, Date.now()); // Update last seen
  
  if (!wasPresent) {
    const presence = await getPresenceInfo();
    console.log(`[presence] ${user} joined (${getPresent().length} online: ${getPresent().join(', ')})`);
    broadcastPresence('join', user, presence);
  }
}

async function removePresence(connId: string): Promise<void> {
  const entry = activeConnections.get(connId);
  if (!entry) return;
  
  activeConnections.delete(connId);
  userLastSeen.set(entry.user, Date.now()); // Record when they left
  const stillPresent = getPresent().includes(entry.user);
  
  if (!stillPresent) {
    const presence = await getPresenceInfo();
    console.log(`[presence] ${entry.user} left (${getPresent().length} online: ${getPresent().join(', ')})`);
    broadcastPresence('leave', entry.user, presence);
  }
}

function broadcastPresence(type: 'join' | 'leave', user: string, presence: PresenceInfo[]): void {
  for (const listener of presenceListeners) {
    try {
      listener({ type, user, presence });
    } catch (e) {
      // Listener error, will be cleaned up when stream closes
    }
  }
}

// Record API activity for presence tracking
async function recordApiActivity(user: string): Promise<void> {
  const wasPresent = getPresent().includes(user);
  lastApiActivity.set(user, Date.now());
  userLastSeen.set(user, Date.now());
  
  if (!wasPresent) {
    const presence = await getPresenceInfo();
    console.log(`[presence] ${user} active via API (${getPresent().length} online: ${getPresent().join(', ')})`);
    broadcastPresence('join', user, presence);
  }
}

// Periodic cleanup: check for stale API presence and emit leave events
setInterval(async () => {
  const now = Date.now();
  for (const [user, timestamp] of lastApiActivity) {
    // Check if this user JUST went stale (within last check interval + small buffer)
    const timeSinceActivity = now - timestamp;
    if (timeSinceActivity >= API_PRESENCE_TIMEOUT_MS && timeSinceActivity < API_PRESENCE_TIMEOUT_MS + 35000) {
      // Only emit leave if user has no active SSE connections
      const hasSSE = Array.from(activeConnections.values()).some(e => e.user === user);
      if (!hasSSE) {
        const presence = await getPresenceInfo();
        console.log(`[presence] ${user} API timeout (${getPresent().length} online: ${getPresent().join(', ')})`);
        broadcastPresence('leave', user, presence);
      }
    }
  }
}, 30000); // Check every 30 seconds

// ============================================================

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
async function requireAuth(
  request: Request,
  handler: (auth: AuthContext, request: Request) => Promise<Response>
): Promise<Response> {
  const auth = authenticate(request);
  if (!auth) {
    return error("Unauthorized", 401);
  }
  try {
    // Record API activity for presence tracking (fire and forget)
    recordApiActivity(auth.identity).catch(() => {});
    return await handler(auth, request);
  } catch (err) {
    console.error("[api] Handler error:", err);
    return error("Internal server error", 500);
  }
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

  // Emit real-time event to recipient
  emit(recipient, {
    type: "message",
    recipient,
    sender: auth.identity,
    messageId: message.id.toString(),
    title: body.title,
    urgent: body.urgent || false,
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

  // Emit inbox check event
  emit(auth.identity, {
    type: "inbox_check",
    mailbox: auth.identity,
    action: "list",
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

  // Emit inbox check event
  emit(auth.identity, {
    type: "inbox_check",
    mailbox: auth.identity,
    action: "ack",
  });

  return json({ message: serializeMessage(message) });
}

async function handleBatchAck(
  auth: AuthContext,
  request: Request
): Promise<Response> {
  let body: { ids?: (string | number)[] };
  try {
    body = await request.json() as { ids?: (string | number)[] };
  } catch (err) {
    console.error("[api] Batch ack JSON parse error:", err);
    return error("Invalid JSON body", 400);
  }
  
  if (!body.ids || !Array.isArray(body.ids)) {
    return error("ids array is required", 400);
  }

  let ids: bigint[];
  try {
    ids = body.ids.map(id => BigInt(id));
  } catch (err) {
    console.error("[api] Batch ack BigInt conversion error:", err);
    return error("Invalid id format", 400);
  }

  try {
    const result = await ackMessages(auth.identity, ids);

    // Emit inbox check event
    emit(auth.identity, {
      type: "inbox_check",
      mailbox: auth.identity,
      action: "ack",
    });

    return json({
      success: result.success.map(String),
      notFound: result.notFound.map(String),
    });
  } catch (err) {
    console.error("[api] Batch ack DB error:", err);
    return error("Database error", 500);
  }
}

async function handleReply(
  auth: AuthContext,
  id: string,
  request: Request
): Promise<Response> {
  const original = await getMessage(auth.identity, BigInt(id));
  if (!original) {
    return error("Original message not found", 404);
  }

  const body = await request.json() as Partial<SendMessageInput>;
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
    metadata: body.metadata,
  });

  return json({ message: serializeMessage(message) }, 201);
}

// ============================================================
// RESPONSE WAITING HANDLERS
// ============================================================

async function handleMarkWaiting(
  auth: AuthContext,
  id: string
): Promise<Response> {
  const messageId = BigInt(id);
  
  // Verify the message exists and the caller is the recipient (the one making the promise)
  const original = await getMessage(auth.identity, messageId);
  if (!original) {
    return error("Message not found", 404);
  }
  
  const updated = await markWaiting(messageId, auth.identity);
  if (!updated) {
    return error("Failed to mark waiting", 500);
  }
  
  // Emit event so sender knows their message has a waiting response
  emit(original.sender, {
    type: "message_waiting",
    messageId: messageId.toString(),
    responder: auth.identity,
  });
  
  return json({ message: serializeMessage(updated) });
}

async function handleClearWaiting(
  auth: AuthContext,
  id: string
): Promise<Response> {
  const messageId = BigInt(id);
  
  // Get the message to verify permissions and get the sender for notification
  const rows = await import("./db/client").then(m => m.sql`
    SELECT * FROM public.mailbox_messages WHERE id = ${messageId}
  `);
  
  if (rows.length === 0) {
    return error("Message not found", 404);
  }
  
  const msg = rows[0];
  
  // Only the waiting_responder can clear (the one who made the promise)
  if (msg.waiting_responder !== auth.identity) {
    return error("Only the waiting responder can clear this", 403);
  }
  
  const updated = await clearWaiting(messageId);
  if (!updated) {
    return error("Failed to clear waiting", 500);
  }
  
  // Emit event so sender knows the waiting response was resolved
  emit(msg.sender as string, {
    type: "waiting_cleared",
    messageId: messageId.toString(),
    responder: auth.identity,
  });
  
  return json({ message: serializeMessage(updated) });
}

async function handleMyWaiting(
  auth: AuthContext
): Promise<Response> {
  const messages = await listMyWaiting(auth.identity);
  return json({ 
    messages: messages.map(serializeMessage),
    count: messages.length 
  });
}

async function handleWaitingOnOthers(
  auth: AuthContext
): Promise<Response> {
  const messages = await listWaitingOnOthers(auth.identity);
  return json({ 
    messages: messages.map(serializeMessage),
    count: messages.length 
  });
}

async function handleWaitingCounts(
  _auth: AuthContext
): Promise<Response> {
  const counts = await getWaitingCounts();
  return json({ counts });
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

  // Emit inbox check event
  emit(auth.identity, {
    type: "inbox_check",
    mailbox: auth.identity,
    action: "search",
  });

  return json({ messages: messages.map(serializeMessage) });
}

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
  responseWaiting?: boolean;
  waitingResponder?: string | null;
  waitingSince?: Date | null;
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
    responseWaiting: msg.responseWaiting || false,
    waitingResponder: msg.waitingResponder || null,
    waitingSince: msg.waitingSince?.toISOString() || null,
  };
}

// ============================================================
// SHARED HEADER COMPONENT
// ============================================================
// Extracted from logged-out /ui (the gold standard)

type HeaderConfig = {
  activeTab: 'messages' | 'buzz' | 'swarm';
  loggedIn: boolean;
  key?: string;  // UI key for nav links
};

// Icons
const ICONS = {
  mail: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
  buzz: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/></svg>',
  swarm: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 14l2 2 4-4"/><path d="M9 8h6"/></svg>',
  key: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4Z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg>',
  bell: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
};

function renderHeader(config: HeaderConfig): string {
  const { activeTab, loggedIn, key } = config;
  const keyPath = key ? '/' + key : '';
  
  const titleIcon = activeTab === 'messages' ? ICONS.mail : (activeTab === 'buzz' ? ICONS.buzz : ICONS.swarm);
  const titleText = activeTab === 'messages' ? 'Messages' : (activeTab === 'buzz' ? 'Buzz' : 'Swarm');
  
  // Build nav - uses key path when logged in
  let nav = `
      <div class="nav">
        <a href="/ui${keyPath}"${activeTab === 'messages' ? ' class="active"' : ''}>Messages</a>
        <a href="/ui${keyPath}/buzz"${activeTab === 'buzz' ? ' class="active"' : ''}>Buzz</a>
        <a href="/ui${keyPath}/swarm"${activeTab === 'swarm' ? ' class="active"' : ''}>Swarm</a>`;
  
  if (loggedIn) {
    // Logged in: Logout | bell | theme
    nav += `
        <button onclick="logout()" style="color:var(--muted-foreground);padding:6px 12px;border-radius:var(--radius);font-size:0.875rem;background:transparent;border:1px solid var(--border);cursor:pointer;">Logout</button>
        <button id="soundToggle" class="icon-btn" onclick="toggleSound()" title="Toggle notification sound">${ICONS.bell}</button>`;
  } else {
    // Logged out: key | theme (matches /ui exactly)
    nav += `
        <button id="keyBtn" class="icon-btn" onclick="toggleKeyPopover()" title="Enter mailbox key">
          ${ICONS.key}
        </button>
        <div id="keyPopover" style="display:none;position:absolute;top:50px;right:80px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:12px;z-index:1000;box-shadow:0 4px 12px rgba(0,0,0,0.3);">
          <input id="keyInput" type="text" placeholder="Enter mailbox key" style="width:180px;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--background);color:var(--foreground);margin-bottom:8px;">
          <div style="display:flex;gap:8px;">
            <button onclick="submitKey()" style="flex:1;padding:6px 12px;background:var(--primary);color:white;border:none;border-radius:var(--radius);cursor:pointer;">Go</button>
            <button onclick="toggleKeyPopover()" style="padding:6px 12px;background:transparent;border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;color:var(--foreground);">Cancel</button>
          </div>
        </div>`;
  }
  
  // Default to sun icon (JS will update based on theme)
  const defaultThemeIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
  nav += `
        <button id="themeToggle" class="theme-toggle" onclick="toggleTheme()" title="Toggle theme">${defaultThemeIcon}</button>
      </div>`;
  
  return `
    <div class="header">
      <h1>
        ${titleIcon}
        ${titleText}
      </h1>
${nav}
    </div>
    <div id="presenceIndicators"></div>
    <div id="statsBar" class="stats-bar"></div>`;
}

// Shared JS for header - theme, key popover, logout
const headerJS = `
    // Theme icons
    const sunIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
    const moonIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
    const bellIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
    const bellOffIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/></svg>';
    
    function updateThemeIcon() {
      const btn = document.getElementById('themeToggle');
      if (btn) btn.innerHTML = document.body.classList.contains('light') ? moonIcon : sunIcon;
    }
    
    function toggleTheme() {
      const isLight = document.body.classList.toggle('light');
      localStorage.setItem('theme', isLight ? 'light' : 'dark');
      updateThemeIcon();
    }
    
    function toggleKeyPopover() {
      const popover = document.getElementById('keyPopover');
      if (!popover) return;
      const input = document.getElementById('keyInput');
      if (popover.style.display === 'none' || !popover.style.display) {
        popover.style.display = 'block';
        if (input) input.focus();
      } else {
        popover.style.display = 'none';
      }
    }
    
    function submitKey() {
      const input = document.getElementById('keyInput');
      const key = input ? input.value.trim() : '';
      if (key) {
        localStorage.setItem('hive_mailbox_key', key);
        window.location.href = '/ui/' + encodeURIComponent(key);
      }
    }
    
    function logout() {
      localStorage.removeItem('hive_mailbox_key');
      window.location.href = '/ui';
    }
    
    document.addEventListener('keydown', function(e) {
      const popover = document.getElementById('keyPopover');
      if (popover && popover.style.display === 'block') {
        if (e.key === 'Enter') submitKey();
        if (e.key === 'Escape') toggleKeyPopover();
      }
    });
    
    // Initialize theme
    if (localStorage.getItem('theme') === 'light') {
      document.body.classList.add('light');
    }
    updateThemeIcon();
`;

// UI endpoint: HTML page (no auth, internal only)
async function handleUI(): Promise<Response> {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#0ea5e9">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="manifest" href="/ui/manifest.json">
  <link rel="icon" href="/ui/assets/icon.png" type="image/png">
  <link rel="apple-touch-icon" href="/ui/assets/icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700&display=swap" rel="stylesheet">
  <title>Hive - Messages</title>
  <style>
    :root {
      --background: #0a0a0a;
      --foreground: #fafafa;
      --card: #18181b;
      --card-foreground: #fafafa;
      --primary: #0ea5e9;
      --primary-foreground: #f0f9ff;
      --secondary: #27272a;
      --secondary-foreground: #fafafa;
      --muted: #27272a;
      --muted-foreground: #a1a1aa;
      --accent: #0ea5e9;
      --accent-foreground: #f0f9ff;
      --border: #27272a;
      --input: #27272a;
      --radius: 8px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: var(--background); color: var(--foreground); min-height: 100vh; padding: 20px; }
    .container { max-width: 900px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
    .header h1 { font-size: 1.5rem; font-weight: 600; display: flex; align-items: center; gap: 8px; margin: 0; }
    .nav { display: flex; gap: 8px; align-items: center; }
    .nav a { color: var(--muted-foreground); text-decoration: none; padding: 6px 12px; border-radius: var(--radius); font-size: 0.875rem; height: 36px; display: inline-flex; align-items: center; }
    .nav a:hover { background: var(--secondary); color: var(--foreground); }
    .nav a.active { background: var(--primary); color: var(--primary-foreground); }
    .nav .icon-btn { width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; padding: 0; line-height: 0; background: transparent; border: none; cursor: pointer; color: var(--foreground); opacity: 0.7; }
    .nav .icon-btn:hover { opacity: 1; }
    .nav .icon-btn svg, .theme-toggle svg { width: 18px; height: 18px; display: block; }
    .theme-toggle { width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; padding: 0; line-height: 0; background: var(--secondary); border: none; border-radius: var(--radius); cursor: pointer; color: var(--foreground); }
    .controls { margin-bottom: 16px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    select, button { font-family: inherit; padding: 8px 14px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--card); color: var(--foreground); cursor: pointer; font-size: 0.875rem; transition: all 0.15s ease; }
    select:hover, button:hover { border-color: var(--ring); background: var(--secondary); }
    select:focus, button:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 2px rgba(56,189,248,0.2); }
    button.primary { background: var(--primary); color: var(--primary-foreground); border-color: var(--primary); font-weight: 600; }
    button.primary:hover { background: #0ea5e9; }
    .status { font-size: 0.8125rem; color: var(--muted-foreground); display: flex; align-items: center; gap: 6px; }
    .status::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--muted-foreground); }
    .status.connected { color: #22c55e; }
    .status.connected::before { background: #22c55e; box-shadow: 0 0 8px rgba(34,197,94,0.5); }
    .messages { display: flex; flex-direction: column; gap: 10px; }
    .message { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; transition: all 0.15s ease; }
    .message:hover { border-color: var(--ring); }
    .message.urgent { border-left: 3px solid #f59e0b; }
    .message.unread { background: #2a2a2e; border-color: var(--primary); }
    .message-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 0.8125rem; }
    .message-meta { color: var(--muted-foreground); }
    .message-meta .sender { color: var(--primary); font-weight: 600; }
    .message-meta .recipient { color: #a78bfa; }
    .avatar { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; margin-right: 10px; flex-shrink: 0; }
    .avatar-placeholder { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; margin-right: 10px; flex-shrink: 0; text-transform: uppercase; }
    .message-row { display: flex; align-items: flex-start; }
    .message-content { flex: 1; min-width: 0; }
    .message-title { font-weight: 600; margin-bottom: 4px; font-size: 0.9375rem; }
    .message-body { color: var(--muted-foreground); font-size: 0.875rem; white-space: pre-wrap; line-height: 1.6; }
    .badge { font-size: 0.6875rem; padding: 3px 8px; border-radius: calc(var(--radius) * 0.6); font-weight: 600; text-transform: uppercase; letter-spacing: 0.025em; }
    .badge.urgent { background: rgba(245,158,11,0.15); color: #fbbf24; }
    .badge.unread { background: rgba(56,189,248,0.15); color: var(--primary); }
    .new-message { animation: highlight 2s ease-out; }
    @keyframes highlight { from { background: rgba(56,189,248,0.1); } to { background: var(--card); } }
    /* Presence indicators */
    #presenceIndicators { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; }
    .presence-avatar { position: relative; width: 28px; height: 28px; flex-shrink: 0; }
    .presence-avatar img, .presence-avatar .avatar-placeholder { width: 28px; height: 28px; border-radius: 50%; font-size: 11px; opacity: 0.5; transition: opacity 0.2s ease; }
    .presence-avatar img { object-fit: cover; }
    .presence-avatar .avatar-placeholder { display: flex; align-items: center; justify-content: center; font-weight: 600; }
    .presence-avatar.online img, .presence-avatar.online .avatar-placeholder { opacity: 1; }
    .presence-avatar .ring { position: absolute; inset: -2px; border-radius: 50%; border: 2px solid transparent; transition: all 0.2s ease; }
    .presence-avatar.online .ring { border-color: #22c55e; box-shadow: 0 0 8px rgba(34,197,94,0.4); }
    .filters { display: flex; gap: 12px; align-items: center; }
    .filter-label { display: flex; align-items: center; gap: 6px; font-size: 0.8125rem; color: var(--muted-foreground); cursor: pointer; }
    .filter-label input { cursor: pointer; accent-color: var(--primary); }
    .empty-state { text-align: center; color: var(--muted-foreground); padding: 48px 20px; }
    /* Light mode */
    body.light {
      --background: #fafafa;
      --foreground: #18181b;
      --card: #ffffff;
      --card-foreground: #18181b;
      --primary: #0ea5e9;
      --primary-foreground: #f0f9ff;
      --secondary: #f4f4f5;
      --secondary-foreground: #18181b;
      --muted: #f4f4f5;
      --muted-foreground: #71717a;
      --accent: #0ea5e9;
      --accent-foreground: #f0f9ff;
      --border: #e4e4e7;
      --input: #e4e4e7;
      --ring: #a1a1aa;
    }
    body.light .message.unread { background: #f0f9ff; }
    body.light .message.selected { background: #e0f2fe; }
    body.light .badge.urgent { background: rgba(245,158,11,0.1); color: #d97706; }
    body.light .badge.unread { background: rgba(14,165,233,0.1); color: #0284c7; }
    body.light .presence-avatar img, body.light .presence-avatar .avatar-placeholder { opacity: 0.65; }
    body.light .presence-avatar.online img, body.light .presence-avatar.online .avatar-placeholder { opacity: 1; }
    body.light .presence-avatar.online .ring { border-color: #16a34a; box-shadow: 0 0 8px rgba(22,163,74,0.4); }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
        Messages
      </h1>
      <div class="nav">
        <a href="/ui" class="active">Messages</a>
        <a href="/ui/buzz">Buzz</a>
        <button id="keyBtn" class="icon-btn" onclick="toggleKeyPopover()" title="Enter mailbox key">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4Z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg>
        </button>
        <div id="keyPopover" style="display:none;position:absolute;top:50px;right:80px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:12px;z-index:1000;box-shadow:0 4px 12px rgba(0,0,0,0.3);">
          <input id="keyInput" type="text" placeholder="Enter mailbox key" style="width:180px;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--background);color:var(--foreground);margin-bottom:8px;">
          <div style="display:flex;gap:8px;">
            <button onclick="submitKey()" style="flex:1;padding:6px 12px;background:var(--primary);color:white;border:none;border-radius:var(--radius);cursor:pointer;">Go</button>
            <button onclick="toggleKeyPopover()" style="padding:6px 12px;background:transparent;border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;color:var(--foreground);">Cancel</button>
          </div>
        </div>
        <button id="themeToggle" class="theme-toggle" onclick="toggleTheme()" title="Toggle theme"></button>
      </div>
    </div>
    <div id="presenceIndicators"></div>
  <div class="controls">
    <select id="recipient">
      <option value="">All mailboxes</option>
      <option value="chris">chris</option>
      <option value="clio">clio</option>
      <option value="domingo">domingo</option>
      <option value="zumie">zumie</option>
    </select>
    <div class="filters">
      <label class="filter-label"><input type="checkbox" id="filterUrgent" onchange="loadMessages()"> Urgent only</label>
      <label class="filter-label"><input type="checkbox" id="filterUnread" onchange="loadMessages()"> Unread only</label>
    </div>
    <button onclick="loadMessages()">Refresh</button>
    <span id="status" class="status">Connecting...</span>
  </div>
    <div id="messages" class="messages"></div>
  </div>

  <script>
    let eventSource = null;
    let lastId = null;

    // Avatar images (served from /ui/assets/avatars/)
    const avatarData = {
      chris: '/ui/assets/avatars/chris.jpg',
      clio: '/ui/assets/avatars/clio.png',
      domingo: '/ui/assets/avatars/domingo.jpg',
      zumie: '/ui/assets/avatars/zumie.png'
    }
    const avatarColors = {
      chris: { bg: '#1e3a5f', fg: '#93c5fd' },
      clio: { bg: '#3f1e5f', fg: '#c4b5fd' },
      domingo: { bg: '#1e5f3a', fg: '#86efac' },
      zumie: { bg: '#5f3a1e', fg: '#fcd34d' }
    };

    // Theme toggle
    const sunIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
    const moonIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
    
    function updateThemeIcon() {
      const btn = document.getElementById('themeToggle');
      if (btn) btn.innerHTML = document.body.classList.contains('light') ? moonIcon : sunIcon;
    }
    
    function toggleKeyPopover() {
      const popover = document.getElementById('keyPopover');
      const input = document.getElementById('keyInput');
      if (popover.style.display === 'none') {
        popover.style.display = 'block';
        input.focus();
      } else {
        popover.style.display = 'none';
      }
    }
    
    function submitKey() {
      const input = document.getElementById('keyInput');
      const key = input.value.trim();
      if (key) {
        localStorage.setItem('hive_mailbox_key', key);
        window.location.href = '/ui/' + encodeURIComponent(key);
      }
    }
    
    // Handle Enter key in input
    document.addEventListener('DOMContentLoaded', () => {
      const input = document.getElementById('keyInput');
      if (input) {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') submitKey();
          if (e.key === 'Escape') toggleKeyPopover();
        });
      }
    });
    
    // Auto-redirect if we have a stored key AND running as installed PWA
    (function() {
      const storedKey = localStorage.getItem('hive_mailbox_key');
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
      if (storedKey && window.location.pathname === '/ui' && isStandalone) {
        window.location.href = '/ui/' + encodeURIComponent(storedKey);
      }
    })();
    
    function toggleTheme() {
      const isLight = document.body.classList.toggle('light');
      localStorage.setItem('theme', isLight ? 'light' : 'dark');
      updateThemeIcon();
    }
    // Restore theme on load
    if (localStorage.getItem('theme') === 'light') {
      document.body.classList.add('light');
    }
    updateThemeIcon();

    // Global /ui is a read-only admin view: sound disabled
    // Notification sound variables (kept for playNotificationSound compatibility)
    const SOUND_KEY = 'mailbox.soundEnabled';
    let soundEnabled = false; // Always off for global view
    let audioContext = null;
    let audioUnlocked = false;

    function updateSoundButton() {
      const btn = document.getElementById('soundToggle');
      if (!btn) return;
      btn.textContent = soundEnabled ? '🔈' : '🔇';
      btn.title = soundEnabled ? 'Mute notifications' : 'Unmute notifications';
    }

    function toggleSound() {
      soundEnabled = !soundEnabled;
      localStorage.setItem(SOUND_KEY, JSON.stringify(soundEnabled));
      updateSoundButton();
    }

    async function ensureAudioUnlocked() {
      try {
        if (!audioContext) {
          audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }
        audioUnlocked = true;
      } catch (e) {
        // ignore
      }
    }

    // First user gesture unlocks audio
    document.addEventListener('pointerdown', () => { ensureAudioUnlocked(); }, { once: true });

    function playNotificationSound() {
      try {
        if (!soundEnabled) return;
        if (!audioUnlocked) return;
        if (!audioContext) return;

        const now = audioContext.currentTime;
        const gainNode = audioContext.createGain();
        gainNode.gain.setValueAtTime(0.0, now);
        gainNode.gain.linearRampToValueAtTime(0.03, now + 0.005);
        gainNode.gain.linearRampToValueAtTime(0.0, now + 0.065);
        gainNode.connect(audioContext.destination);

        const o1 = audioContext.createOscillator();
        o1.type = 'sine';
        o1.frequency.setValueAtTime(1320, now);
        o1.connect(gainNode);
        o1.start(now);
        o1.stop(now + 0.020);

        const o2 = audioContext.createOscillator();
        o2.type = 'sine';
        o2.frequency.setValueAtTime(880, now + 0.020);
        o2.connect(gainNode);
        o2.start(now + 0.020);
        o2.stop(now + 0.065);
      } catch (e) {
        // ignore
      }
    }

    function getAvatarHtml(name) {
      if (avatarData[name]) {
        return \`<img class="avatar" src="\${avatarData[name]}" alt="">\`;
      }
      const colors = avatarColors[name] || { bg: '#333', fg: '#888' };
      const initial = (name || '?')[0];
      return \`<div class="avatar-placeholder" style="background:\${colors.bg};color:\${colors.fg}">\${initial}</div>\`;
    }

    function formatDate(iso) {
      const d = new Date(iso);
      const now = Date.now();
      const diff = now - d.getTime();
      const mins = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);
      
      let relative;
      if (mins < 1) relative = 'just now';
      else if (mins < 60) relative = mins + 'm ago';
      else if (hours < 24) relative = hours + 'h ago';
      else relative = days + 'd ago';
      
      return \`<span title="\${d.toLocaleString()}">\${relative}</span>\`;
    }

    function renderMessage(msg, isNew = false) {
      const classes = ['message'];
      if (msg.urgent) classes.push('urgent');
      if (msg.status === 'unread') classes.push('unread');
      if (isNew) classes.push('new-message');

      return \`
        <div class="\${classes.join(' ')}">
          <div class="message-row">
            \${getAvatarHtml(msg.sender)}
            <div class="message-content">
              <div class="message-header">
                <span class="message-meta">
                  <span class="sender">\${msg.sender}</span> → <span class="recipient">\${msg.recipient}</span>
                </span>
                <span class="message-meta">\${formatDate(msg.createdAt)}</span>
              </div>
              <div class="message-title">
                \${msg.urgent ? '<span class="badge urgent">URGENT</span> ' : ''}
                \${msg.status === 'unread' ? '<span class="badge unread">UNREAD</span> ' : ''}
                \${msg.title}
              </div>
              \${msg.body ? \`<div class="message-body">\${msg.body}</div>\` : ''}
            </div>
          </div>
        </div>
      \`;
    }

    async function loadMessages() {
      // Public /ui page: show login prompt instead of messages
      const container = document.getElementById('messages');
      container.innerHTML = '<div style="text-align:center;color:#888;padding:48px 20px;"><p style="font-size:1.1rem;margin-bottom:16px;">🔐 Please log in to view messages</p><p>Click the key icon above to enter your mailbox key.</p></div>';
    }

    // Presence state with lastSeen timestamps
    let presenceData = [];
    const FADE_DURATION_MS = 15 * 60 * 1000; // 15 minutes

    function getPresenceColor(info) {
      if (info.online) return { ring: '#22c55e', shadow: 'rgba(34,197,94,0.4)', name: '#22c55e' };
      if (!info.lastSeen) return { ring: 'var(--muted)', shadow: 'none', name: 'var(--muted-foreground)' };
      
      const elapsed = Date.now() - info.lastSeen;
      const fadeRatio = Math.min(elapsed / FADE_DURATION_MS, 1);
      
      // Interpolate from green to grey
      const g = Math.round(197 - (197 - 113) * fadeRatio); // 197 (green) -> 113 (grey)
      const r = Math.round(34 + (113 - 34) * fadeRatio);   // 34 -> 113
      const b = Math.round(94 + (113 - 94) * fadeRatio);   // 94 -> 113
      const opacity = 0.4 - (0.4 * fadeRatio);
      
      return {
        ring: \`rgb(\${r},\${g},\${b})\`,
        shadow: opacity > 0.05 ? \`rgba(\${r},\${g},\${b},\${opacity})\` : 'none',
        name: \`rgb(\${r},\${g},\${b})\`
      };
    }

    function renderPresence(presence) {
      presenceData = presence || presenceData;
      const container = document.getElementById('presenceIndicators');
      container.innerHTML = presenceData.map(info => {
        const pc = getPresenceColor(info);
        const status = info.online ? 'online' : (info.lastSeen ? \`last seen \${Math.round((Date.now() - info.lastSeen) / 60000)}m ago\` : 'offline');
        const avatar = avatarData[info.user];
        const colors = avatarColors[info.user] || { bg: '#333', fg: '#888' };
        const initial = info.user[0].toUpperCase();
        // Use same <img> approach as Messages for consistency
        const avatarHtml = avatar
          ? \`<img class="avatar" src="\${avatar}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">\`
          : '';
        const fallbackStyle = avatar ? 'display:none' : '';
        return \`
          <div class="presence-avatar\${info.online ? ' online' : ''}" title="\${info.user} - \${status}">
            <div class="ring" style="border-color:\${pc.ring};\${pc.shadow !== 'none' ? 'box-shadow:0 0 8px ' + pc.shadow : ''}"></div>
            \${avatarHtml}
            <div class="avatar-placeholder" style="background:\${colors.bg};color:\${colors.fg};\${fallbackStyle}">\${initial}</div>
          </div>
        \`;
      }).join('');
    }

    // Update presence colors every 30 seconds for fade effect
    setInterval(() => renderPresence(), 30000);

    function connectSSE() {
      // Public /ui page: no SSE connection (requires login)
      document.getElementById('status').textContent = 'Not connected (login required)';
      document.getElementById('status').className = 'status';
    }
    
    function connectSSE_disabled() {
      const recipient = document.getElementById('recipient').value;
      const url = recipient ? '/ui/stream?recipient=' + recipient : '/ui/stream';
      
      if (eventSource) {
        eventSource.close();
      }
      
      eventSource = new EventSource(url);
      
      eventSource.onopen = () => {
        document.getElementById('status').textContent = 'Connected';
        document.getElementById('status').className = 'status connected';
      };
      
      eventSource.onerror = () => {
        document.getElementById('status').textContent = 'Disconnected';
        document.getElementById('status').className = 'status';
        setTimeout(connectSSE, 3000);
      };
      
      // Handle presence events
      eventSource.addEventListener('presence', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.presence) {
            renderPresence(data.presence);
          }
        } catch (err) {
          console.error('Presence parse error:', err);
        }
      });
      
      let refreshTimeout = null;
      let initialLoadComplete = false;
      const seenMessageIds = new Set();
      setTimeout(() => { initialLoadComplete = true; }, 2000);
      
      eventSource.addEventListener('message', (e) => {
        // (no sound in global /ui view)
        // Debounce: refresh at most every 500ms
        if (!refreshTimeout) {
          refreshTimeout = setTimeout(() => {
            loadMessages();
            refreshTimeout = null;
          }, 500);
        }
      });
    }

    document.getElementById('recipient').addEventListener('change', () => {
      loadMessages();
      connectSSE();
    });

    // Initial render with default presence (all offline)
    renderPresence([
      { user: 'chris', online: false, lastSeen: 0 },
      { user: 'clio', online: false, lastSeen: 0 },
      { user: 'domingo', online: false, lastSeen: 0 },
      { user: 'zumie', online: false, lastSeen: 0 }
    ]);
    loadMessages();
    connectSSE();
  </script>
<!-- build: img-avatars-v3 -->
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
}

// UI endpoint: JSON messages (no auth, internal only)
async function handleUIMessages(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const recipient = url.searchParams.get("recipient") || undefined;
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const sinceId = url.searchParams.get("sinceId");
  const urgentOnly = url.searchParams.get("urgent") === "true";
  const unreadOnly = url.searchParams.get("unread") === "true";
  
  // Access control: require a valid UI key
  const uiKey = url.searchParams.get("key");
  if (!uiKey) {
    return error("Unauthorized - login required", 401);
  }
  
  const config = uiMailboxKeys[uiKey];
  if (!config) {
    return error("Unauthorized - invalid key", 401);
  }
  
  const viewer = config.sender;
  const isAdmin = config.admin || false;

  // For non-admins: don't use recipient filter from dropdown
  // Access control filter will handle visibility
  const effectiveRecipient = isAdmin ? recipient : undefined;
  
  let messages = await listAllMessages({
    recipient: effectiveRecipient,
    limit: urgentOnly || unreadOnly ? 200 : limit, // Fetch more if filtering
    sinceId: sinceId ? BigInt(sinceId) : undefined,
  });

  // Access control filter: non-admins only see their own messages
  if (!isAdmin) {
    messages = messages.filter(m => m.sender === viewer || m.recipient === viewer);
    
    // If dropdown has a specific mailbox selected, also filter to conversations with that user
    if (recipient && recipient !== viewer) {
      messages = messages.filter(m => m.sender === recipient || m.recipient === recipient);
    }
  }

  // Apply filters
  if (urgentOnly) {
    messages = messages.filter(m => m.urgent);
  }
  if (unreadOnly) {
    messages = messages.filter(m => m.status === 'unread');
  }
  
  // Re-apply limit after filtering
  messages = messages.slice(0, limit);

  return json({ messages: messages.map(serializeMessage) });
}

// Valid users for presence tracking (prevents spoofing)
const VALID_PRESENCE_USERS = ['chris', 'clio', 'domingo', 'zumie'];

// UI endpoint: SSE stream (requires key for auth)
async function handleUIStream(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const recipient = url.searchParams.get("recipient") || undefined;
  
  // Access control: require valid UI key
  const uiKey = url.searchParams.get("key");
  if (!uiKey) {
    return error("Unauthorized - login required", 401);
  }
  const keyConfig = uiMailboxKeys[uiKey];
  if (!keyConfig) {
    return error("Unauthorized - invalid key", 401);
  }
  
  const viewer = keyConfig.sender;
  const isAdmin = keyConfig.admin || false;
  
  const connId = generateConnectionId();
  
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      
      // Track presence if viewer is specified and valid
      if (viewer) {
        addPresence(connId, viewer, 'ui');
      }
      
      // Helper to filter presence based on viewer permissions
      const filterPresence = (presenceList: PresenceInfo[]) => {
        if (isAdmin) return presenceList;
        return presenceList.map(p => ({
          user: p.user,
          online: p.online,
          lastSeen: p.lastSeen,
          unread: p.user === viewer ? p.unread : 0,
          waiting: p.user === viewer ? p.waiting : 0
        }));
      };
      
      // Send initial connection event with current presence
      controller.enqueue(encoder.encode(`: connected to UI stream\n\n`));
      getPresenceInfo().then(presence => {
        try {
          const filtered = filterPresence(presence);
          controller.enqueue(encoder.encode(`event: presence\ndata: ${JSON.stringify({ presence: filtered })}\n\n`));
        } catch { /* stream may be closed */ }
      });
      
      // Listen for presence changes
      const presenceHandler: PresenceListener = (event) => {
        if (closed) return;
        try {
          // Filter presence in the event
          const filteredEvent = {
            ...event,
            presence: filterPresence(event.presence)
          };
          controller.enqueue(encoder.encode(`event: presence\ndata: ${JSON.stringify(filteredEvent)}\n\n`));
        } catch {
          closed = true;
        }
      };
      presenceListeners.add(presenceHandler);
      
      // Listen for swarm events (task changes)
      const swarmHandler: SwarmEventListener = (event) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: swarm\ndata: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };
      swarmEventListeners.add(swarmHandler);
      
      const pingInterval = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          closed = true;
          clearInterval(pingInterval);
        }
      }, 30000);
      
      let lastSeenId = 0n;
      const pollInterval = setInterval(async () => {
        if (closed) return;
        try {
          let messages = await listAllMessages({ 
            recipient,
            limit: 10,
            sinceId: lastSeenId > 0n ? lastSeenId : undefined 
          });
          
          // Access control: non-admins only see their own messages
          if (!isAdmin) {
            messages = messages.filter(m => m.sender === viewer || m.recipient === viewer);
          }
          
          // Sort by id ascending for proper event order
          messages.sort((a, b) => Number(a.id - b.id));
          
          for (const msg of messages) {
            if (closed) break;
            if (msg.id > lastSeenId) {
              try {
                controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(serializeMessage(msg))}\n\n`));
                lastSeenId = msg.id;
              } catch {
                closed = true;
                break;
              }
            }
          }
        } catch (err) {
          if (!closed) console.error("[ui-sse] Poll error:", err);
        }
      }, 3000);
      
      return () => {
        closed = true;
        clearInterval(pingInterval);
        clearInterval(pollInterval);
        presenceListeners.delete(presenceHandler);
        swarmEventListeners.delete(swarmHandler);
        if (viewer) {
          removePresence(connId);
        }
      };
    },
  });
  
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// Presence endpoint - returns current online users
async function handlePresence(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const uiKey = url.searchParams.get("key");
  
  // Get full presence info
  const allPresence = await getPresenceInfo();
  
  // If no key or invalid key, return presence with counts hidden
  if (!uiKey) {
    // Show online status only, hide counts
    return json({ 
      presence: allPresence.map(p => ({ 
        user: p.user, 
        online: p.online, 
        lastSeen: p.lastSeen,
        unread: 0,  // Hidden
        waiting: 0  // Hidden
      }))
    });
  }
  
  const config = uiMailboxKeys[uiKey];
  if (!config) {
    return json({ 
      presence: allPresence.map(p => ({ 
        user: p.user, 
        online: p.online, 
        lastSeen: p.lastSeen,
        unread: 0,
        waiting: 0
      }))
    });
  }
  
  const viewer = config.sender;
  const isAdmin = config.admin || false;
  
  // Admin sees all counts
  if (isAdmin) {
    return json({ presence: allPresence });
  }
  
  // Non-admin: only show their own counts, hide others
  return json({ 
    presence: allPresence.map(p => ({
      user: p.user,
      online: p.online,
      lastSeen: p.lastSeen,
      unread: p.user === viewer ? p.unread : 0,
      waiting: p.user === viewer ? p.waiting : 0
    }))
  });
}

// UI with compose (keyed)
async function handleUIWithKey(key: string): Promise<Response> {
  const config = uiMailboxKeys[key];
  if (!config) {
    return error("Invalid key", 404);
  }
  
  const sender = config.sender;
  const recipients = ["chris", "clio", "domingo", "zumie"].filter(r => r !== sender);
  
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#0ea5e9">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="manifest" href="/ui/manifest.json">
  <link rel="icon" href="/ui/assets/icon.png" type="image/png">
  <link rel="apple-touch-icon" href="/ui/assets/icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700&display=swap" rel="stylesheet">
  <title>Hive - Messages</title>
  <style>
    :root {
      --background: #18181b;
      --foreground: #fafafa;
      --card: #27272a;
      --card-foreground: #fafafa;
      --primary: #38bdf8;
      --primary-foreground: #082f49;
      --secondary: #3f3f46;
      --secondary-foreground: #fafafa;
      --muted: #3f3f46;
      --muted-foreground: #a1a1aa;
      --accent: #38bdf8;
      --accent-foreground: #082f49;
      --destructive: #ef4444;
      --border: rgba(255,255,255,0.1);
      --input: rgba(255,255,255,0.15);
      --ring: #71717a;
      --radius: 0.625rem;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Nunito Sans', system-ui, sans-serif; background: var(--background); color: var(--foreground); padding: 20px; line-height: 1.5; max-width: 900px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
    .header h1 { font-size: 1.5rem; font-weight: 600; display: flex; align-items: center; gap: 8px; margin: 0; }
    .nav { display: flex; gap: 8px; align-items: center; }
    .nav a { color: var(--muted-foreground); text-decoration: none; padding: 6px 12px; border-radius: var(--radius); font-size: 0.875rem; height: 36px; display: inline-flex; align-items: center; }
    .nav a:hover { background: var(--secondary); color: var(--foreground); }
    .nav a.active { background: var(--primary); color: var(--primary-foreground); }
    .nav .icon-btn { width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; padding: 0; line-height: 0; background: transparent; border: none; cursor: pointer; color: var(--foreground); opacity: 0.7; }
    .nav .icon-btn:hover { opacity: 1; }
    .nav .icon-btn svg, .theme-toggle svg { width: 18px; height: 18px; display: block; }
    .theme-toggle { width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; padding: 0; line-height: 0; background: var(--secondary); border: none; border-radius: var(--radius); cursor: pointer; color: var(--foreground); }
    h1 { margin-bottom: 16px; font-size: 1.25rem; font-weight: 700; color: var(--foreground); display: flex; align-items: center; gap: 8px; }
    .controls { margin-bottom: 16px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    select, button, input, textarea { font-family: inherit; padding: 8px 14px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--card); color: var(--foreground); font-size: 0.875rem; transition: all 0.15s ease; }
    select:hover, button:hover { border-color: var(--ring); background: var(--secondary); }
    select:focus, button:focus, input:focus, textarea:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 2px rgba(56,189,248,0.2); }
    button { cursor: pointer; }
    button.primary { background: var(--primary); color: var(--primary-foreground); border-color: var(--primary); font-weight: 600; }
    button.primary:hover { background: #0ea5e9; }
    .status { font-size: 0.8125rem; color: var(--muted-foreground); display: flex; align-items: center; gap: 6px; }
    .status::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--muted-foreground); }
    .status.connected { color: #22c55e; }
    .status.connected::before { background: #22c55e; box-shadow: 0 0 8px rgba(34,197,94,0.5); }
    .messages { display: flex; flex-direction: column; gap: 10px; }
    .message { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; cursor: pointer; transition: all 0.15s ease; }
    .message:hover { border-color: var(--ring); }
    .message.selected { border-color: var(--primary); background: rgba(56,189,248,0.1); }
    .message.urgent { border-left: 3px solid #f59e0b; }
    .message.unread { background: #2a2a2e; border-color: var(--primary); }
    .message-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 0.8125rem; }
    .message-meta { color: var(--muted-foreground); }
    .message-meta .sender { color: var(--primary); font-weight: 600; }
    .message-meta .recipient { color: #a78bfa; }
    .avatar { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; margin-right: 10px; flex-shrink: 0; }
    .avatar-placeholder { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; margin-right: 10px; flex-shrink: 0; text-transform: uppercase; }
    .message-row { display: flex; align-items: flex-start; }
    .message-content { flex: 1; min-width: 0; }
    .message-title { font-weight: 600; margin-bottom: 4px; font-size: 0.9375rem; }
    .message-body { color: var(--muted-foreground); font-size: 0.875rem; white-space: pre-wrap; line-height: 1.6; }
    .badge { font-size: 0.6875rem; padding: 3px 8px; border-radius: calc(var(--radius) * 0.6); font-weight: 600; text-transform: uppercase; letter-spacing: 0.025em; }
    .badge.urgent { background: rgba(245,158,11,0.15); color: #fbbf24; }
    .badge.unread { background: rgba(56,189,248,0.15); color: var(--primary); }
    .badge.waiting { background: rgba(168,85,247,0.15); color: #a855f7; }
    .stats-bar { display: flex; gap: 16px; align-items: center; margin-bottom: 12px; font-size: 0.875rem; color: var(--muted-foreground); }
    .stats-bar .stat { display: flex; align-items: center; gap: 6px; }
    .stats-bar .stat-count { font-weight: 700; color: var(--foreground); }
    .stats-bar .stat-count.has-items { color: var(--primary); }
    .stats-bar .stat-count.waiting { color: #a855f7; }
    .new-message { animation: highlight 2s ease-out; }
    @keyframes highlight { from { background: rgba(56,189,248,0.1); } to { background: var(--card); } }
    /* Compose panel */
    .compose { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 16px; overflow: hidden; }
    .compose-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; cursor: pointer; transition: background 0.15s ease; }
    .compose-header:hover { background: var(--secondary); }
    .compose-header h2 { font-size: 0.9375rem; font-weight: 600; margin: 0; color: var(--foreground); display: flex; align-items: center; gap: 8px; }
    .compose-toggle { color: var(--muted-foreground); font-size: 0.75rem; }
    .compose-body { padding: 0 16px 16px; }
    .compose.collapsed .compose-body { display: none; }
    /* Filter controls */
    .filters { display: flex; gap: 14px; align-items: center; }
    .filter-label { display: flex; align-items: center; gap: 6px; font-size: 0.8125rem; color: var(--muted-foreground); cursor: pointer; }
    .filter-label input { cursor: pointer; accent-color: var(--primary); }
    /* Mark read button */
    .mark-read-btn { font-size: 0.6875rem; padding: 4px 10px; margin-left: 8px; background: rgba(56,189,248,0.15); border: 1px solid transparent; color: var(--primary); font-weight: 600; }
    .mark-read-btn:hover { background: var(--primary); color: var(--primary-foreground); }
    /* Copy ID button */
    .copy-id-btn { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; margin-right: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #ffffff; cursor: pointer; border-radius: 4px; transition: all 0.15s; }
    .copy-id-btn:hover { background: rgba(255,255,255,0.2); border-color: rgba(255,255,255,0.3); }
    .copy-id-btn.copied { background: rgba(34,197,94,0.2); border-color: rgba(34,197,94,0.4); color: #22c55e; }
    .copy-id-btn svg { pointer-events: none; display: block; width: 14px !important; height: 14px !important; min-width: 14px; flex: 0 0 auto; stroke: currentColor; }
    /* Theme toggle - uses same styling as nav buttons */
    /* Compose form */
    .compose-row { display: flex; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; }
    .compose-row label { color: var(--muted-foreground); font-size: 0.8125rem; min-width: 70px; font-weight: 600; }
    .compose-row input[type="text"], .compose-row textarea { flex: 1; min-width: 200px; }
    .compose-row textarea { min-height: 80px; resize: vertical; }
    .compose-row .checkbox-label { display: flex; align-items: center; gap: 8px; font-size: 0.8125rem; color: var(--muted-foreground); }
    .compose-actions { display: flex; gap: 10px; align-items: center; }
    .compose-status { font-size: 0.8125rem; margin-left: 12px; }
    .compose-status.success { color: #22c55e; }
    .compose-status.error { color: var(--destructive); }
    .reply-info { font-size: 0.8125rem; color: var(--primary); margin-bottom: 12px; padding: 10px; background: rgba(56,189,248,0.1); border-radius: var(--radius); border: 1px solid rgba(56,189,248,0.2); }
    /* Presence indicators */
    #presenceIndicators { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; }
    .presence-avatar { position: relative; width: 28px; height: 28px; flex-shrink: 0; }
    .presence-avatar img, .presence-avatar .avatar-placeholder { width: 28px; height: 28px; border-radius: 50%; font-size: 11px; opacity: 0.5; transition: opacity 0.2s ease; }
    .presence-avatar img { object-fit: cover; }
    .presence-avatar .avatar-placeholder { display: flex; align-items: center; justify-content: center; font-weight: 600; }
    .presence-avatar.online img, .presence-avatar.online .avatar-placeholder { opacity: 1; }
    .presence-avatar .ring { position: absolute; inset: -2px; border-radius: 50%; border: 2px solid transparent; transition: all 0.2s ease; }
    .presence-avatar.online .ring { border-color: #22c55e; box-shadow: 0 0 8px rgba(34,197,94,0.4); }
    .empty-state { text-align: center; color: var(--muted-foreground); padding: 48px 20px; }
    /* Light mode */
    body.light {
      --background: #fafafa;
      --foreground: #18181b;
      --card: #ffffff;
      --card-foreground: #18181b;
      --primary: #0ea5e9;
      --primary-foreground: #f0f9ff;
      --secondary: #f4f4f5;
      --secondary-foreground: #18181b;
      --muted: #f4f4f5;
      --muted-foreground: #71717a;
      --accent: #0ea5e9;
      --accent-foreground: #f0f9ff;
      --border: #e4e4e7;
      --input: #e4e4e7;
      --ring: #a1a1aa;
    }
    body.light .compose { background: var(--card); border-color: var(--border); }
    body.light .compose-header:hover { background: var(--secondary); }
    body.light .message.unread { background: #f0f9ff; }
    body.light .message.selected { background: #e0f2fe; }
    body.light .badge.urgent { background: rgba(245,158,11,0.1); color: #d97706; }
    body.light .badge.unread { background: rgba(14,165,233,0.1); color: #0284c7; }
    body.light .reply-info { background: #e0f2fe; border-color: #bae6fd; color: #0369a1; }
    body.light .mark-read-btn { background: #e0f2fe; color: #0369a1; }
    body.light .mark-read-btn:hover { background: var(--primary); color: white; }
    body.light .copy-id-btn { background: rgba(0,0,0,0.05); border-color: rgba(0,0,0,0.15); color: #374151; }
    body.light .copy-id-btn:hover { background: rgba(0,0,0,0.1); border-color: rgba(0,0,0,0.2); }
    body.light .copy-id-btn.copied { background: rgba(34,197,94,0.15); border-color: rgba(34,197,94,0.3); color: #16a34a; }
    body.light .presence-avatar img, body.light .presence-avatar .avatar-placeholder { opacity: 0.65; }
    body.light .presence-avatar.online img, body.light .presence-avatar.online .avatar-placeholder { opacity: 1; }
    body.light .presence-avatar.online .ring { border-color: #16a34a; box-shadow: 0 0 8px rgba(22,163,74,0.4); }
  </style>
</head>
<body>
${renderHeader({ activeTab: 'messages', loggedIn: true, key })}
  
  <div id="composePanel" class="compose collapsed">
    <div class="compose-header" onclick="toggleCompose()">
      <h2>✏️ Compose Message</h2>
      <span class="compose-toggle" id="composeToggle">▼ expand</span>
    </div>
    <div class="compose-body">
      <div id="replyInfo" class="reply-info" style="display:none;"></div>
      <div class="compose-row">
        <label>From:</label>
        <strong>${sender}</strong>
      </div>
      <div class="compose-row">
        <label>To:</label>
        <select id="composeRecipient">
          ${recipients.map(r => '<option value="' + r + '">' + r + '</option>').join('')}
        </select>
      </div>
      <div class="compose-row">
        <label>Title:</label>
        <input type="text" id="composeTitle" placeholder="Message title">
      </div>
      <div class="compose-row">
        <label>Body:</label>
        <textarea id="composeBody" placeholder="Message body (optional)"></textarea>
      </div>
      <div class="compose-row">
        <label></label>
        <label class="checkbox-label">
          <input type="checkbox" id="composeUrgent"> Urgent
        </label>
      </div>
      <div class="compose-actions">
        <button class="primary" onclick="sendMessage()">Send</button>
        <button onclick="clearReply()">Clear</button>
        <span id="composeStatus" class="compose-status"></span>
      </div>
    </div>
  </div>

  <div class="controls">
    <select id="recipient">
      ${config.admin ? '<option value="">All mailboxes</option>' : ''}
      <option value="chris"${sender === 'chris' ? ' selected' : ''}>chris</option>
      <option value="clio"${sender === 'clio' ? ' selected' : ''}>clio</option>
      <option value="domingo"${sender === 'domingo' ? ' selected' : ''}>domingo</option>
      <option value="zumie"${sender === 'zumie' ? ' selected' : ''}>zumie</option>
    </select>
    <div class="filters">
      <label class="filter-label"><input type="checkbox" id="filterUrgent" onchange="loadMessages()"> Urgent only</label>
      <label class="filter-label"><input type="checkbox" id="filterUnread" onchange="loadMessages()"> Unread only</label>
      <label class="filter-label"><input type="checkbox" id="filterWaiting" onchange="loadMessages()"> Waiting only</label>
    </div>
    <button onclick="loadMessages()">Refresh</button>
    <span id="status" class="status">Connecting...</span>
  </div>
  <div id="messages" class="messages"></div>

  <script>
    const MAILBOX_KEY = '${key}';
    let eventSource = null;
    let lastId = null;
    let selectedMessage = null;
    let replyToId = null;
    const CURRENT_SENDER = '${sender}';
    const IS_ADMIN = ${config.admin ? 'true' : 'false'};

    const avatarData = {
      chris: '/ui/assets/avatars/chris.jpg',
      clio: '/ui/assets/avatars/clio.png',
      domingo: '/ui/assets/avatars/domingo.jpg',
      zumie: '/ui/assets/avatars/zumie.png'
    }
    const avatarColors = {
      chris: { bg: '#1e3a5f', fg: '#93c5fd' },
      clio: { bg: '#3f1e5f', fg: '#c4b5fd' },
      domingo: { bg: '#1e5f3a', fg: '#86efac' },
      zumie: { bg: '#5f3a1e', fg: '#fcd34d' }
    };

    // Logout - clear stored key and redirect
    function logout() {
      localStorage.removeItem('hive_mailbox_key');
      window.location.href = '/ui';
    }
    
    // Compose panel toggle
    function toggleCompose() {
      const panel = document.getElementById('composePanel');
      const toggle = document.getElementById('composeToggle');
      const isCollapsed = panel.classList.contains('collapsed');
      if (isCollapsed) {
        panel.classList.remove('collapsed');
        toggle.textContent = '▲ collapse';
        localStorage.setItem('composeExpanded', 'true');
      } else {
        panel.classList.add('collapsed');
        toggle.textContent = '▼ expand';
        localStorage.setItem('composeExpanded', 'false');
      }
    }

    // Restore compose state from localStorage on load
    document.addEventListener('DOMContentLoaded', function() {
      if (localStorage.getItem('composeExpanded') === 'true') {
        document.getElementById('composePanel').classList.remove('collapsed');
        document.getElementById('composeToggle').textContent = '▲ collapse';
      }
      // Restore theme
      if (localStorage.getItem('theme') === 'light') {
        document.body.classList.add('light');
      }
      updateThemeIcon();
      updateSoundButton();
    });

    // Theme toggle
    const sunIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
    const moonIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
    const bellIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
    const bellOffIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/></svg>';
    
    function updateThemeIcon() {
      const btn = document.getElementById('themeToggle');
      if (btn) btn.innerHTML = document.body.classList.contains('light') ? moonIcon : sunIcon;
    }
    
    function toggleTheme() {
      const isLight = document.body.classList.toggle('light');
      localStorage.setItem('theme', isLight ? 'light' : 'dark');
      updateThemeIcon();
    }
    // Notification sound (gentle "tink" using Web Audio API)
    // - very short (~60ms), low volume
    // - mute toggle stored in localStorage
    // - only plays after a user gesture (AudioContext unlocked)
    const SOUND_KEY = 'mailbox.soundEnabled';
    let soundEnabled = JSON.parse(localStorage.getItem(SOUND_KEY) ?? 'true');
    let audioContext = null;
    let audioUnlocked = false;

    function updateSoundButton() {
      const btn = document.getElementById('soundToggle');
      if (!btn) return;
      btn.innerHTML = soundEnabled ? bellIcon : bellOffIcon;
      btn.title = soundEnabled ? 'Mute notifications' : 'Unmute notifications';
    }

    function toggleSound() {
      soundEnabled = !soundEnabled;
      localStorage.setItem(SOUND_KEY, JSON.stringify(soundEnabled));
      updateSoundButton();
    }

    async function ensureAudioUnlocked() {
      try {
        if (!audioContext) {
          audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }
        audioUnlocked = true;
      } catch (e) {
        // ignore
      }
    }

    // First user gesture unlocks audio
    document.addEventListener('pointerdown', () => { ensureAudioUnlocked(); }, { once: true });

    function playNotificationSound() {
      try {
        if (!soundEnabled) return;
        if (!audioUnlocked) return;
        if (!audioContext) return;

        const now = audioContext.currentTime;
        const gainNode = audioContext.createGain();
        gainNode.gain.setValueAtTime(0.0, now);
        gainNode.gain.linearRampToValueAtTime(0.03, now + 0.005);
        gainNode.gain.linearRampToValueAtTime(0.0, now + 0.065);
        gainNode.connect(audioContext.destination);

        const o1 = audioContext.createOscillator();
        o1.type = 'sine';
        o1.frequency.setValueAtTime(1320, now);
        o1.connect(gainNode);
        o1.start(now);
        o1.stop(now + 0.020);

        const o2 = audioContext.createOscillator();
        o2.type = 'sine';
        o2.frequency.setValueAtTime(880, now + 0.020);
        o2.connect(gainNode);
        o2.start(now + 0.020);
        o2.stop(now + 0.065);
      } catch (e) {
        // ignore
      }
    }

    // Mark message as read
    async function markAsRead(msgId) {
      try {
        const res = await fetch('/ui/' + MAILBOX_KEY + '/ack/' + msgId, { method: 'POST' });
        if (res.ok) {
          loadMessages();
        } else {
          console.error('Failed to mark as read');
        }
      } catch (e) {
        console.error('Mark as read error:', e);
      }
    }

    async function copyMessageId(msgId) {
      const btn = event.target.closest('.copy-id-btn');
      let success = false;
      
      // Try modern clipboard API first
      if (navigator?.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(msgId);
          success = true;
        } catch (e) { /* fall through to legacy */ }
      }
      
      // Fallback: execCommand with hidden textarea
      if (!success) {
        const ta = document.createElement('textarea');
        ta.value = msgId;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
          success = document.execCommand('copy');
        } catch (e) { /* ignore */ }
        document.body.removeChild(ta);
      }
      
      // Visual feedback - show checkmark and "copied" state
      if (success && btn) {
        const original = btn.innerHTML;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        btn.classList.add('copied');
        setTimeout(() => { 
          btn.innerHTML = original; 
          btn.classList.remove('copied');
        }, 1500);
      }
    }

    function getAvatarHtml(name) {
      if (avatarData[name]) {
        return \`<img class="avatar" src="\${avatarData[name]}" alt="">\`;
      }
      const colors = avatarColors[name] || { bg: '#333', fg: '#888' };
      const initial = (name || '?')[0];
      return \`<div class="avatar-placeholder" style="background:\${colors.bg};color:\${colors.fg}">\${initial}</div>\`;
    }

    function formatDate(iso) {
      const d = new Date(iso);
      const now = Date.now();
      const diff = now - d.getTime();
      const mins = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);
      
      let relative;
      if (mins < 1) relative = 'just now';
      else if (mins < 60) relative = mins + 'm ago';
      else if (hours < 24) relative = hours + 'h ago';
      else relative = days + 'd ago';
      
      return \`<span title="\${d.toLocaleString()}">\${relative}</span>\`;
    }

    function renderMessage(msg, isNew = false) {
      const classes = ['message'];
      if (msg.urgent) classes.push('urgent');
      if (msg.status === 'unread') classes.push('unread');
      if (isNew) classes.push('new-message');
      if (selectedMessage === msg.id) classes.push('selected');
      
      const canMarkRead = msg.recipient === CURRENT_SENDER && msg.status === 'unread';
      const markReadBtn = canMarkRead 
        ? \`<button class="mark-read-btn" onclick="event.stopPropagation(); markAsRead('\${msg.id}')">Mark read</button>\`
        : '';
      
      // SVG copy icon - using single quotes for SVG attributes to avoid escaping issues
      const copyIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
      const copyBtn = \`<button class="copy-id-btn" onclick="event.stopPropagation(); copyMessageId('\${msg.id}')" title="Copy message ID">\${copyIcon}</button>\`;

      return \`
        <div class="\${classes.join(' ')}" data-id="\${msg.id}" data-sender="\${msg.sender}" data-title="\${msg.title.replace(/"/g, '&quot;')}" onclick="selectMessage(this)">
          <div class="message-row">
            \${getAvatarHtml(msg.sender)}
            <div class="message-content">
              <div class="message-header">
                <span class="message-meta">
                  <span class="sender">\${msg.sender}</span> → <span class="recipient">\${msg.recipient}</span>
                </span>
                <span class="message-meta">\${copyBtn}\${formatDate(msg.createdAt)}\${markReadBtn}</span>
              </div>
              <div class="message-title">
                \${msg.urgent ? '<span class="badge urgent">URGENT</span> ' : ''}
                \${msg.status === 'unread' ? '<span class="badge unread">UNREAD</span> ' : ''}
                \${msg.responseWaiting ? '<span class="badge waiting">WAITING</span> ' : ''}
                \${msg.title}
              </div>
              \${msg.body ? \`<div class="message-body">\${msg.body}</div>\` : ''}
            </div>
          </div>
        </div>
      \`;
    }

    function selectMessage(el) {
      document.querySelectorAll('.message.selected').forEach(m => m.classList.remove('selected'));
      el.classList.add('selected');
      selectedMessage = el.dataset.id;
      replyToId = el.dataset.id;
      const sender = el.dataset.sender;
      const title = el.dataset.title;
      
      document.getElementById('replyInfo').textContent = 'Replying to: #' + replyToId + ' from ' + sender + ' - "' + title + '"';
      document.getElementById('replyInfo').style.display = 'block';
      document.getElementById('composeTitle').value = 'Re: ' + title;
      
      // Set recipient to original sender
      const recipientSelect = document.getElementById('composeRecipient');
      for (let i = 0; i < recipientSelect.options.length; i++) {
        if (recipientSelect.options[i].value === sender) {
          recipientSelect.selectedIndex = i;
          break;
        }
      }
    }

    function clearReply() {
      replyToId = null;
      selectedMessage = null;
      document.querySelectorAll('.message.selected').forEach(m => m.classList.remove('selected'));
      document.getElementById('replyInfo').style.display = 'none';
      document.getElementById('composeTitle').value = '';
      document.getElementById('composeBody').value = '';
      document.getElementById('composeUrgent').checked = false;
      document.getElementById('composeStatus').textContent = '';
    }

    async function sendMessage() {
      const recipient = document.getElementById('composeRecipient').value;
      const title = document.getElementById('composeTitle').value.trim();
      const body = document.getElementById('composeBody').value.trim();
      const urgent = document.getElementById('composeUrgent').checked;
      
      if (!title && !body) {
        document.getElementById('composeStatus').textContent = 'Title or body required';
        document.getElementById('composeStatus').className = 'compose-status error';
        return;
      }
      
      const payload = { recipient, title, body, urgent };
      if (replyToId) payload.replyToMessageId = replyToId;
      
      try {
        const res = await fetch('/ui/' + MAILBOX_KEY + '/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
          document.getElementById('composeStatus').textContent = 'Sent!';
          document.getElementById('composeStatus').className = 'compose-status success';
          clearReply();
          loadMessages();
        } else {
          document.getElementById('composeStatus').textContent = data.error || 'Send failed';
          document.getElementById('composeStatus').className = 'compose-status error';
        }
      } catch (e) {
        document.getElementById('composeStatus').textContent = 'Network error';
        document.getElementById('composeStatus').className = 'compose-status error';
      }
    }

    async function loadMessages() {
      const recipient = document.getElementById('recipient').value;
      const filterUrgent = document.getElementById('filterUrgent')?.checked || false;
      const filterUnread = document.getElementById('filterUnread')?.checked || false;
      const filterWaiting = document.getElementById('filterWaiting')?.checked || false;
      const params = new URLSearchParams({ limit: '50' });
      if (recipient) params.set('recipient', recipient);
      if (filterUrgent) params.set('urgent', 'true');
      if (filterUnread) params.set('unread', 'true');
      
      // Pass key for server-side access control
      params.set('key', MAILBOX_KEY);
      const res = await fetch('/ui/messages?' + params);
      const data = await res.json();
      
      // Server-side access control already applied; client-side filter for waiting
      let messages = data.messages;
      if (filterWaiting) {
        messages = messages.filter(m => m.responseWaiting && m.waitingResponder === CURRENT_SENDER);
      }
      
      const container = document.getElementById('messages');
      if (messages.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:#888;padding:40px;">No messages match filters</div>';
      } else {
        container.innerHTML = messages.map(m => renderMessage(m)).join('');
      }
      
      if (data.messages.length > 0) {
        lastId = data.messages[0].id;
        // Add all loaded messages to seen set (so we don't beep on reconnect)
        data.messages.forEach(m => seenMessageIds.add(m.id));
      }
      // Mark initial load complete (enable sounds for truly new messages)
      initialLoadComplete = true;
    }

    // Presence state with lastSeen timestamps
    let presenceData = [];
    const FADE_DURATION_MS = 15 * 60 * 1000; // 15 minutes

    function getPresenceColor(info) {
      if (info.online) return { ring: '#22c55e', shadow: 'rgba(34,197,94,0.4)', name: '#22c55e' };
      if (!info.lastSeen) return { ring: 'var(--muted)', shadow: 'none', name: 'var(--muted-foreground)' };
      
      const elapsed = Date.now() - info.lastSeen;
      const fadeRatio = Math.min(elapsed / FADE_DURATION_MS, 1);
      
      // Interpolate from green to grey
      const g = Math.round(197 - (197 - 113) * fadeRatio);
      const r = Math.round(34 + (113 - 34) * fadeRatio);
      const b = Math.round(94 + (113 - 94) * fadeRatio);
      const opacity = 0.4 - (0.4 * fadeRatio);
      
      return {
        ring: \`rgb(\${r},\${g},\${b})\`,
        shadow: opacity > 0.05 ? \`rgba(\${r},\${g},\${b},\${opacity})\` : 'none',
        name: \`rgb(\${r},\${g},\${b})\`
      };
    }

    function renderPresence(presence) {
      presenceData = presence || presenceData;
      const container = document.getElementById('presenceIndicators');
      container.innerHTML = presenceData.map(info => {
        const status = info.online ? 'online' : (info.lastSeen ? \`last seen \${Math.round((Date.now() - info.lastSeen) / 60000)}m ago\` : 'offline');
        const avatar = avatarData[info.user];
        const colors = avatarColors[info.user] || { bg: '#333', fg: '#888' };
        const initial = info.user[0].toUpperCase();
        // Use same <img> approach as Messages for consistency
        const avatarHtml = avatar
          ? \`<img class="avatar" src="\${avatar}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">\`
          : '';
        const fallbackStyle = avatar ? 'display:none' : '';
        return \`
          <div class="presence-avatar\${info.online ? ' online' : ''}" title="\${info.user} - \${status}">
            <div class="ring"></div>
            \${avatarHtml}
            <div class="avatar-placeholder" style="background:\${colors.bg};color:\${colors.fg};\${fallbackStyle}">\${initial}</div>
          </div>
        \`;
      }).join('');
      
      // Update stats bar with unread and waiting counts for current user
      const statsBar = document.getElementById('statsBar');
      if (statsBar && presenceData) {
        const myInfo = presenceData.find(p => p.user === CURRENT_SENDER);
        if (myInfo) {
          const unread = myInfo.unread || 0;
          const waiting = myInfo.waiting || 0;
          statsBar.innerHTML = \`
            <span class="stat">Unread: <span class="stat-count \${unread > 0 ? 'has-items' : ''}">\${unread}</span></span>
            <span class="stat">Waiting: <span class="stat-count waiting \${waiting > 0 ? 'has-items' : ''}">\${waiting}</span></span>
          \`;
        }
      }
    }

    // Track seen messages globally (persists across SSE reconnects)
    const seenMessageIds = new Set();
    let initialLoadComplete = false;

    function connectSSE() {
      const recipient = document.getElementById('recipient').value;
      // Include key for auth and access control
      let url = '/ui/stream?key=' + encodeURIComponent(MAILBOX_KEY);
      if (recipient) url += '&recipient=' + encodeURIComponent(recipient);
      
      if (eventSource) eventSource.close();
      eventSource = new EventSource(url);
      
      eventSource.onopen = () => {
        document.getElementById('status').textContent = 'Connected';
        document.getElementById('status').className = 'status connected';
      };
      
      eventSource.onerror = () => {
        document.getElementById('status').textContent = 'Disconnected';
        document.getElementById('status').className = 'status';
        setTimeout(connectSSE, 3000);
      };
      
      // Handle presence events
      eventSource.addEventListener('presence', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.presence) {
            renderPresence(data.presence);
          }
        } catch (err) {
          console.error('Presence parse error:', err);
        }
      });
      
      let refreshTimeout = null;
      
      eventSource.addEventListener('message', (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg?.id && seenMessageIds.has(msg.id)) return;
          if (msg?.id) seenMessageIds.add(msg.id);
          if (initialLoadComplete && msg?.recipient === CURRENT_SENDER) {
            playNotificationSound();
          }
        } catch (_) {
          // ignore
        }
        if (!refreshTimeout) {
          refreshTimeout = setTimeout(() => {
            loadMessages();
            refreshTimeout = null;
          }, 500);
        }
      });
    }

    document.getElementById('recipient').addEventListener('change', () => {
      loadMessages();
      connectSSE();
    });

    // Initial render with default presence (all offline)
    renderPresence([
      { user: 'chris', online: false, lastSeen: 0 },
      { user: 'clio', online: false, lastSeen: 0 },
      { user: 'domingo', online: false, lastSeen: 0 },
      { user: 'zumie', online: false, lastSeen: 0 }
    ]);
    loadMessages();
    connectSSE();
  </script>
<!-- build: img-avatars-v3 -->
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
}

// UI send endpoint (keyed)
async function handleUISend(key: string, request: Request): Promise<Response> {
  const config = uiMailboxKeys[key];
  if (!config) {
    return error("Invalid key", 404);
  }
  
  const sender = config.sender;
  
  let body: { recipient?: string; title?: string; body?: string; urgent?: boolean; replyToMessageId?: string };
  try {
    body = await request.json();
  } catch {
    return error("Invalid JSON", 400);
  }
  
  const { recipient, title, urgent, replyToMessageId } = body;
  const msgBody = body.body;
  
  if (!recipient || !isValidMailbox(recipient)) {
    return error("Invalid recipient", 400);
  }
  
  if (!title && !msgBody) {
    return error("title or body is required", 400);
  }
  
  try {
    const message = await sendMessage({
      recipient,
      sender,
      title: title || "",
      body: msgBody,
      urgent: urgent || false,
      replyToMessageId: replyToMessageId ? BigInt(replyToMessageId) : undefined,
    });
    
    return json({ message: serializeMessage(message) }, 201);
  } catch (err) {
    console.error("[ui-send] Error:", err);
    return error("Failed to send message", 500);
  }
}

// UI ack endpoint (keyed)
async function handleUIAck(key: string, msgId: string): Promise<Response> {
  const config = uiMailboxKeys[key];
  if (!config) {
    return error("Invalid key", 404);
  }
  
  const sender = config.sender;
  
  try {
    const message = await ackMessage(sender, BigInt(msgId));
    if (!message) {
      return error("Message not found or not yours", 404);
    }
    return json({ message: serializeMessage(message) });
  } catch (err) {
    console.error("[ui-ack] Error:", err);
    return error("Failed to ack message", 500);
  }
}

// UI-keyed Swarm project creation
async function handleUISwarmCreateProject(key: string, request: Request): Promise<Response> {
  const config = uiMailboxKeys[key];
  if (!config) {
    return error("Invalid key", 404);
  }
  
  const identity = config.sender;
  
  let body: { title?: string; color?: string; projectLeadUserId?: string; developerLeadUserId?: string; description?: string; onedevUrl?: string; dokployDeployUrl?: string };
  try {
    body = await request.json();
  } catch {
    return error("Invalid JSON", 400);
  }
  
  if (!body.title || !body.color || !body.projectLeadUserId || !body.developerLeadUserId) {
    return error("title, color, projectLeadUserId, and developerLeadUserId are required", 400);
  }
  
  // Validate color format
  if (!/^#[0-9A-Fa-f]{6}$/.test(body.color)) {
    return error("color must be a valid hex color (e.g., #FF5500)", 400);
  }
  
  try {
    const project = await swarm.createProject({
      title: body.title,
      color: body.color,
      projectLeadUserId: body.projectLeadUserId,
      developerLeadUserId: body.developerLeadUserId,
      description: body.description,
      onedevUrl: body.onedevUrl,
      dokployDeployUrl: body.dokployDeployUrl,
    });
    
    // Emit Buzz event
    emitSwarmBuzz({
      eventType: 'swarm.project.created',
      projectId: project.id,
      title: project.title,
      actor: identity,
      deepLink: getSwarmDeepLink(),
    });
    
    return json({ project }, 201);
  } catch (err) {
    console.error("[ui-swarm] Error creating project:", err);
    return error("Failed to create project", 500);
  }
}

// UI-keyed Swarm task creation
async function handleUISwarmCreateTask(key: string, request: Request): Promise<Response> {
  const config = uiMailboxKeys[key];
  if (!config) {
    return error("Invalid key", 404);
  }
  
  const identity = config.sender;
  
  let body: { title?: string; projectId?: string; assigneeUserId?: string; detail?: string; issueUrl?: string; onOrAfterAt?: string };
  try {
    body = await request.json();
  } catch {
    return error("Invalid JSON", 400);
  }
  
  if (!body.title) {
    return error("title is required", 400);
  }
  
  try {
    const task = await swarm.createTask({
      title: body.title,
      projectId: body.projectId || undefined,
      assigneeUserId: body.assigneeUserId || undefined,
      detail: body.detail || undefined,
      issueUrl: body.issueUrl || undefined,
      onOrAfterAt: body.onOrAfterAt ? new Date(body.onOrAfterAt) : undefined,
      creatorUserId: identity,
      status: "queued",
    });
    
    // Record creation event
    await swarm.createTaskEvent({
      taskId: task.id,
      actorUserId: identity,
      kind: "created",
      afterState: { title: task.title, status: task.status },
    });
    
    // Emit Buzz event
    emitSwarmBuzz({
      eventType: 'swarm.task.created',
      taskId: task.id,
      projectId: task.projectId || undefined,
      title: task.title,
      actor: identity,
      assignee: task.assigneeUserId,
      status: task.status,
      deepLink: getSwarmDeepLink(task.id),
    });
    
    return json({ task }, 201);
  } catch (err) {
    console.error("[ui-swarm] Error creating task:", err);
    return error("Failed to create task", 500);
  }
}

// UI-keyed Swarm task claim
async function handleUISwarmClaimTask(key: string, taskId: string): Promise<Response> {
  const config = uiMailboxKeys[key];
  if (!config) {
    return error("Invalid key", 404);
  }
  
  const identity = config.sender;
  
  try {
    const task = await swarm.claimTask(taskId, identity);
    if (!task) {
      return error("Task not found", 404);
    }
    
    // Emit Buzz event for assignment
    emitSwarmBuzz({
      eventType: 'swarm.task.assigned',
      taskId: task.id,
      projectId: task.projectId || undefined,
      title: task.title,
      actor: identity,
      assignee: identity,
      status: task.status,
      deepLink: getSwarmDeepLink(task.id),
    });
    
    return json({ task });
  } catch (err) {
    console.error("[ui-swarm] Error claiming task:", err);
    return error("Failed to claim task", 500);
  }
}

// UI-keyed Swarm task update
async function handleUISwarmUpdateTask(key: string, taskId: string, request: Request): Promise<Response> {
  const config = uiMailboxKeys[key];
  if (!config) {
    return error("Invalid key", 404);
  }
  
  const identity = config.sender;
  
  let body: { title?: string; projectId?: string | null; assigneeUserId?: string | null; detail?: string | null; issueUrl?: string | null; mustBeDoneAfterTaskId?: string | null; nextTaskId?: string | null; onOrAfterAt?: string | null };
  try {
    body = await request.json();
  } catch {
    return error("Invalid JSON", 400);
  }
  
  try {
    // Get current task to detect assignment changes
    const oldTask = await swarm.getTask(taskId);
    
    const task = await swarm.updateTask(taskId, {
      title: body.title,
      projectId: body.projectId,
      assigneeUserId: body.assigneeUserId,
      detail: body.detail,
      issueUrl: body.issueUrl,
      mustBeDoneAfterTaskId: body.mustBeDoneAfterTaskId,
      nextTaskId: body.nextTaskId,
      onOrAfterAt: body.onOrAfterAt ? new Date(body.onOrAfterAt) : (body.onOrAfterAt === null ? null : undefined),
    });
    
    if (!task) {
      return error("Task not found", 404);
    }
    
    // Emit Buzz event - check if it was an assignment change
    if (oldTask && body.assigneeUserId !== undefined && oldTask.assigneeUserId !== task.assigneeUserId) {
      emitSwarmBuzz({
        eventType: 'swarm.task.assigned',
        taskId: task.id,
        projectId: task.projectId || undefined,
        title: task.title,
        actor: identity,
        assignee: task.assigneeUserId,
        status: task.status,
        deepLink: getSwarmDeepLink(task.id),
      });
    } else {
      emitSwarmBuzz({
        eventType: 'swarm.task.updated',
        taskId: task.id,
        projectId: task.projectId || undefined,
        title: task.title,
        actor: identity,
        assignee: task.assigneeUserId,
        status: task.status,
        deepLink: getSwarmDeepLink(task.id),
      });
    }
    
    return json({ task });
  } catch (err) {
    console.error("[ui-swarm] Error updating task:", err);
    return error("Failed to update task", 500);
  }
}

// UI-keyed Swarm task status change
async function handleUISwarmTaskStatus(key: string, taskId: string, request: Request): Promise<Response> {
  const config = uiMailboxKeys[key];
  if (!config) {
    return error("Invalid key", 404);
  }
  
  const identity = config.sender;
  
  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    return error("Invalid JSON", 400);
  }
  
  if (!body.status) {
    return error("status is required", 400);
  }
  
  const validStatuses: swarm.TaskStatus[] = ["queued", "ready", "in_progress", "holding", "review", "complete"];
  if (!validStatuses.includes(body.status as swarm.TaskStatus)) {
    return error(`status must be one of: ${validStatuses.join(", ")}`, 400);
  }
  
  try {
    const result = await swarm.updateTaskStatusWithValidation(taskId, body.status as swarm.TaskStatus, identity);
    
    if (!result.success) {
      // Return 400 for blocked transitions
      return error(result.error || "Failed to update status", 400);
    }
    
    const task = result.task;
    if (!task) {
      return error("Task not found", 404);
    }
    
    // Emit Buzz event - special event for completion
    if (body.status === 'complete') {
      emitSwarmBuzz({
        eventType: 'swarm.task.completed',
        taskId: task.id,
        projectId: task.projectId || undefined,
        title: task.title,
        actor: identity,
        assignee: task.assigneeUserId,
        status: task.status,
        deepLink: getSwarmDeepLink(task.id),
      });
    } else {
      emitSwarmBuzz({
        eventType: 'swarm.task.status_changed',
        taskId: task.id,
        projectId: task.projectId || undefined,
        title: task.title,
        actor: identity,
        assignee: task.assigneeUserId,
        status: task.status,
        deepLink: getSwarmDeepLink(task.id),
      });
    }
    
    return json({ task });
  } catch (err) {
    console.error("[ui-swarm] Error updating task status:", err);
    return error("Failed to update task status", 500);
  }
}

// UI-keyed Swarm task reorder
async function handleUISwarmReorderTask(key: string, taskId: string, request: Request): Promise<Response> {
  const config = uiMailboxKeys[key];
  if (!config) {
    return error("Invalid key", 404);
  }
  
  const identity = config.sender;
  
  let body: { beforeTaskId?: string | null };
  try {
    body = await request.json();
  } catch {
    return error("Invalid JSON", 400);
  }
  
  try {
    const task = await swarm.reorderTask(taskId, body.beforeTaskId || null, identity);
    
    if (!task) {
      return error("Task not found", 404);
    }
    
    // Emit Buzz event
    emitSwarmBuzz({
      eventType: 'swarm.task.reordered',
      taskId: task.id,
      projectId: task.projectId || undefined,
      title: task.title,
      actor: identity,
      assignee: task.assigneeUserId,
      status: task.status,
      deepLink: getSwarmDeepLink(task.id),
    });
    
    return json({ task });
  } catch (err) {
    console.error("[ui-swarm] Error reordering task:", err);
    const message = err instanceof Error ? err.message : "Failed to reorder task";
    return error(message, 500);
  }
}

// Serve avatar files
async function handleAvatar(name: string, ext: string): Promise<Response> {
  const validNames = ["chris", "clio", "domingo", "zumie"];
  if (!validNames.includes(name)) {
    return error("Avatar not found", 404);
  }
  
  const filePath = `./assets/avatars/${name}.${ext}`;
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return error("Avatar not found", 404);
    }
    
    const contentType = ext === "svg" ? "image/svg+xml" : ext === "png" ? "image/png" : "image/jpeg";
    return new Response(file, {
      headers: { 
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400"
      }
    });
  } catch {
    return error("Avatar not found", 404);
  }
}

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;
  // Strip /api prefix if present (allows both /api/healthz and /healthz)
  const rawPath = url.pathname;
  const path = rawPath.startsWith("/api/") ? rawPath.slice(4) : rawPath.replace(/^\/api$/, "/");

  try {
    if (path === "/healthz") return handleHealthz();
    if (path === "/skill") return handleSkill();
    if (path === "/readyz") return handleReadyz();
    
    // PWA manifest and icon (serve at both root and /ui/ paths for compatibility)
    if (path === "/manifest.json" || path === "/ui/manifest.json") {
      return new Response(JSON.stringify({
        name: "The Hive",
        short_name: "Hive",
        description: "Internal team messaging and coordination",
        start_url: "/ui",
        scope: "/ui",
        display: "standalone",
        background_color: "#18181b",
        theme_color: "#0ea5e9",
        icons: [
          { src: "/ui/assets/icon.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
        ]
      }), { headers: { "Content-Type": "application/manifest+json" } });
    }
    
    if (path === "/icon.svg" || path === "/ui/icon.svg") {
      const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
        <rect width="512" height="512" rx="80" fill="#0a0a0a"/>
        <rect x="80" y="140" width="352" height="232" rx="20" fill="#1a1a1a" stroke="#2563eb" stroke-width="8"/>
        <path d="M80 180 L256 300 L432 180" fill="none" stroke="#2563eb" stroke-width="8" stroke-linecap="round"/>
        <circle cx="400" cy="160" r="40" fill="#f59e0b"/>
        <text x="400" y="175" font-family="system-ui" font-size="40" font-weight="bold" fill="#0a0a0a" text-anchor="middle">!</text>
      </svg>`;
      return new Response(icon, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });
    }
    
    // App icon
    if (method === "GET" && (path === "/ui/assets/icon.png" || path === "/icon.png")) {
      try {
        const file = Bun.file("./assets/icon.png");
        if (await file.exists()) {
          return new Response(file, { 
            headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } 
          });
        }
      } catch { }
      return error("Icon not found", 404);
    }
    
    // Static assets (avatars)
    const assetMatch = path.match(/^\/ui\/assets\/avatars\/([a-z]+)\.(svg|png|jpg)$/);
    if (method === "GET" && assetMatch) {
      return handleAvatar(assetMatch[1], assetMatch[2]);
    }
    
    // UI endpoints (no auth, internal only)
    if (path === "/ui") return handleUI();
    if (path === "/ui/messages") return handleUIMessages(request);
    if (path === "/ui/stream") return handleUIStream(request);
    if (path === "/ui/presence") return handlePresence(request);
    
    // Buzz UI tab (must be before keyed UI routes)
    // Public Buzz requires login - redirect
    if (path === "/ui/buzz") return Response.redirect("/ui", 302);
    if (path === "/ui/buzz/stream") return handleBroadcastUIStream(request);
    
    // Swarm UI tab (must be before keyed UI routes)
    if (path === "/ui/swarm") return handleSwarmUI();
    if (path === "/ui/swarm/stream") return handleSwarmUIStream(request);
    
    // Keyed UI with compose
    const uiKeyMatch = path.match(/^\/ui\/([a-zA-Z0-9_-]+)$/);
    const uiKeySendMatch = path.match(/^\/ui\/([a-zA-Z0-9_-]+)\/send$/);
    const uiKeyAckMatch = path.match(/^\/ui\/([a-zA-Z0-9_-]+)\/ack\/(\d+)$/);
    const uiKeySwarmMatch = path.match(/^\/ui\/([a-zA-Z0-9_-]+)\/swarm$/);
    const uiKeySwarmRecurringMatch = path.match(/^\/ui\/([a-zA-Z0-9_-]+)\/swarm\/recurring$/);
    const uiKeyBuzzMatch = path.match(/^\/ui\/([a-zA-Z0-9_-]+)\/buzz$/);
    
    if (method === "GET" && uiKeySwarmRecurringMatch) {
      return handleRecurringUIWithKey(uiKeySwarmRecurringMatch[1]);
    }
    if (method === "GET" && uiKeySwarmMatch) {
      return handleSwarmUIWithKey(uiKeySwarmMatch[1]);
    }
    if (method === "GET" && uiKeyBuzzMatch) {
      return handleBroadcastUIWithKey(uiKeyBuzzMatch[1]);
    }
    if (method === "GET" && uiKeyMatch) {
      return handleUIWithKey(uiKeyMatch[1]);
    }
    if (method === "POST" && uiKeySendMatch) {
      return handleUISend(uiKeySendMatch[1], request);
    }
    if (method === "POST" && uiKeyAckMatch) {
      return handleUIAck(uiKeyAckMatch[1], uiKeyAckMatch[2]);
    }
    
    // UI-keyed Swarm endpoints
    const uiKeySwarmProjectsMatch = path.match(/^\/ui\/([a-zA-Z0-9_-]+)\/swarm\/projects$/);
    const uiKeySwarmTasksMatch = path.match(/^\/ui\/([a-zA-Z0-9_-]+)\/swarm\/tasks$/);
    const uiKeySwarmTaskMatch = path.match(/^\/ui\/([a-zA-Z0-9_-]+)\/swarm\/tasks\/([a-f0-9-]+)$/);
    const uiKeySwarmTaskClaimMatch = path.match(/^\/ui\/([a-zA-Z0-9_-]+)\/swarm\/tasks\/([a-f0-9-]+)\/claim$/);
    const uiKeySwarmTaskStatusMatch = path.match(/^\/ui\/([a-zA-Z0-9_-]+)\/swarm\/tasks\/([a-f0-9-]+)\/status$/);
    const uiKeySwarmTaskReorderMatch = path.match(/^\/ui\/([a-zA-Z0-9_-]+)\/swarm\/tasks\/([a-f0-9-]+)\/reorder$/);
    
    if (method === "POST" && uiKeySwarmProjectsMatch) {
      return handleUISwarmCreateProject(uiKeySwarmProjectsMatch[1], request);
    }
    if (method === "POST" && uiKeySwarmTasksMatch) {
      return handleUISwarmCreateTask(uiKeySwarmTasksMatch[1], request);
    }
    if (method === "PATCH" && uiKeySwarmTaskMatch) {
      return handleUISwarmUpdateTask(uiKeySwarmTaskMatch[1], uiKeySwarmTaskMatch[2], request);
    }
    if (method === "POST" && uiKeySwarmTaskClaimMatch) {
      return handleUISwarmClaimTask(uiKeySwarmTaskClaimMatch[1], uiKeySwarmTaskClaimMatch[2]);
    }
    if (method === "POST" && uiKeySwarmTaskStatusMatch) {
      return handleUISwarmTaskStatus(uiKeySwarmTaskStatusMatch[1], uiKeySwarmTaskStatusMatch[2], request);
    }
    if (method === "POST" && uiKeySwarmTaskReorderMatch) {
      return handleUISwarmReorderTask(uiKeySwarmTaskReorderMatch[1], uiKeySwarmTaskReorderMatch[2], request);
    }

    const mailboxMatch = path.match(/^\/mailboxes\/([^/]+)\/messages\/?$/);
    const messageMatch = path.match(/^\/mailboxes\/me\/messages\/(\d+)$/);
    const ackMatch = path.match(/^\/mailboxes\/me\/messages\/(\d+)\/ack$/);
    const replyMatch = path.match(/^\/mailboxes\/me\/messages\/(\d+)\/reply$/);

    if (method === "POST" && mailboxMatch && mailboxMatch[1] !== "me") {
      return requireAuth(request, (auth) => handleSend(auth, mailboxMatch[1], request));
    }

    if (method === "GET" && path === "/mailboxes/me/stream") {
      return requireAuth(request, (auth) => handleStream(auth));
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

    // ============================================================
    // RESPONSE WAITING ENDPOINTS
    // ============================================================

    // Mark a message as waiting response from the authenticated user
    // POST /mailboxes/me/messages/{id}/waiting
    const waitingMatch = path.match(/^\/mailboxes\/me\/messages\/(\d+)\/waiting$/);
    if (method === "POST" && waitingMatch) {
      return requireAuth(request, (auth) => handleMarkWaiting(auth, waitingMatch[1]));
    }

    // Clear waiting flag on a message
    // DELETE /mailboxes/me/messages/{id}/waiting
    if (method === "DELETE" && waitingMatch) {
      return requireAuth(request, (auth) => handleClearWaiting(auth, waitingMatch[1]));
    }

    // List my waiting tasks (tasks I've committed to)
    // GET /mailboxes/me/waiting
    if (method === "GET" && path === "/mailboxes/me/waiting") {
      return requireAuth(request, handleMyWaiting);
    }

    // List messages I'm waiting on others to complete
    // GET /mailboxes/me/waiting-on-others
    if (method === "GET" && path === "/mailboxes/me/waiting-on-others") {
      return requireAuth(request, handleWaitingOnOthers);
    }

    // Get waiting counts for all users
    // GET /waiting/counts
    if (method === "GET" && path === "/waiting/counts") {
      return requireAuth(request, handleWaitingCounts);
    }

    // ============================================================
    // BROADCAST WEBHOOK ENDPOINTS
    // ============================================================
    
    // Create webhook (auth required)
    if (method === "POST" && path === "/broadcast/webhooks") {
      return requireAuth(request, handleCreateWebhook);
    }
    
    // List webhooks (auth required)
    if (method === "GET" && path === "/broadcast/webhooks") {
      return requireAuth(request, handleListWebhooks);
    }
    
    // Get webhook by ID (auth required)
    const webhookIdMatch = path.match(/^\/broadcast\/webhooks\/(\d+)$/);
    if (method === "GET" && webhookIdMatch) {
      return requireAuth(request, (auth) => handleGetWebhook(auth, parseInt(webhookIdMatch[1])));
    }
    
    // Enable/disable webhook (auth required)
    const webhookEnableMatch = path.match(/^\/broadcast\/webhooks\/(\d+)\/(enable|disable)$/);
    if (method === "POST" && webhookEnableMatch) {
      return requireAuth(request, (auth) => handleWebhookToggle(auth, parseInt(webhookEnableMatch[1]), webhookEnableMatch[2] === "enable"));
    }
    
    // Delete webhook (auth required)
    if (method === "DELETE" && webhookIdMatch) {
      return requireAuth(request, (auth) => handleDeleteWebhook(auth, parseInt(webhookIdMatch[1])));
    }
    
    // List broadcast events (auth required)
    if (method === "GET" && path === "/broadcast/events") {
      return requireAuth(request, handleListBroadcastEvents);
    }
    
    // GET /buzz - Simple buzz endpoint for agents (alias for broadcast events)
    if (method === "GET" && path === "/buzz") {
      return requireAuth(request, handleBuzz);
    }
    
    // Ingest endpoint (NO AUTH - public webhook endpoint)
    // Route: /api/ingest/{app_name}/{token} (path has /api stripped, so matches /ingest/...)
    const ingestMatch = path.match(/^\/ingest\/([a-z][a-z0-9_-]*)\/([a-f0-9]{14})$/);
    if (method === "POST" && ingestMatch) {
      return handleWebhookIngest(ingestMatch[1], ingestMatch[2], request);
    }

    // ============================================================
    // SWARM API - Task Management
    // ============================================================
    
    // Projects
    if (method === "GET" && path === "/swarm/projects") {
      return requireAuth(request, handleSwarmListProjects);
    }
    if (method === "POST" && path === "/swarm/projects") {
      return requireAuth(request, (auth) => handleSwarmCreateProject(auth, request));
    }
    const swarmProjectMatch = path.match(/^\/swarm\/projects\/([0-9a-f-]{36})$/);
    if (method === "GET" && swarmProjectMatch) {
      return requireAuth(request, (auth) => handleSwarmGetProject(auth, swarmProjectMatch[1]));
    }
    if (method === "PATCH" && swarmProjectMatch) {
      return requireAuth(request, (auth) => handleSwarmUpdateProject(auth, swarmProjectMatch[1], request));
    }
    const swarmProjectArchiveMatch = path.match(/^\/swarm\/projects\/([0-9a-f-]{36})\/archive$/);
    if (method === "POST" && swarmProjectArchiveMatch) {
      return requireAuth(request, (auth) => handleSwarmArchiveProject(auth, swarmProjectArchiveMatch[1]));
    }
    if (method === "DELETE" && swarmProjectArchiveMatch) {
      return requireAuth(request, (auth) => handleSwarmUnarchiveProject(auth, swarmProjectArchiveMatch[1]));
    }
    
    // Tasks
    if (method === "GET" && path === "/swarm/tasks") {
      return requireAuth(request, (auth) => handleSwarmListTasks(auth, request));
    }
    if (method === "POST" && path === "/swarm/tasks") {
      return requireAuth(request, (auth) => handleSwarmCreateTask(auth, request));
    }
    const swarmTaskMatch = path.match(/^\/swarm\/tasks\/([0-9a-f-]{36})$/);
    if (method === "GET" && swarmTaskMatch) {
      return requireAuth(request, (auth) => handleSwarmGetTask(auth, swarmTaskMatch[1]));
    }
    if (method === "PATCH" && swarmTaskMatch) {
      return requireAuth(request, (auth) => handleSwarmUpdateTask(auth, swarmTaskMatch[1], request));
    }
    const swarmTaskClaimMatch = path.match(/^\/swarm\/tasks\/([0-9a-f-]{36})\/claim$/);
    if (method === "POST" && swarmTaskClaimMatch) {
      return requireAuth(request, (auth) => handleSwarmClaimTask(auth, swarmTaskClaimMatch[1]));
    }
    const swarmTaskStatusMatch = path.match(/^\/swarm\/tasks\/([0-9a-f-]{36})\/status$/);
    if (method === "POST" && swarmTaskStatusMatch) {
      return requireAuth(request, (auth) => handleSwarmUpdateTaskStatus(auth, swarmTaskStatusMatch[1], request));
    }
    const swarmTaskEventsMatch = path.match(/^\/swarm\/tasks\/([0-9a-f-]{36})\/events$/);
    if (method === "GET" && swarmTaskEventsMatch) {
      return requireAuth(request, (auth) => handleSwarmGetTaskEvents(auth, swarmTaskEventsMatch[1]));
    }
    const swarmTaskReorderMatch = path.match(/^\/swarm\/tasks\/([0-9a-f-]{36})\/reorder$/);
    if (method === "POST" && swarmTaskReorderMatch) {
      return requireAuth(request, (auth) => handleSwarmReorderTask(auth, swarmTaskReorderMatch[1], request));
    }
    
    // Recurring templates routes
    if (method === "GET" && path === "/swarm/recurring/templates") {
      return requireAuth(request, async (auth) => {
        try {
          return await handleListTemplates(auth, request);
        } catch (err) {
          console.error("[api] Exception in handleListTemplates:", err);
          return error("List templates failed: " + String(err), 500);
        }
      });
    }
    if (method === "POST" && path === "/swarm/recurring/templates") {
      return requireAuth(request, (auth) => handleCreateTemplate(auth, request));
    }
    const templateMatch = path.match(/^\/swarm\/recurring\/templates\/([0-9a-f-]{36})$/);
    if (method === "GET" && templateMatch) {
      return requireAuth(request, () => handleGetTemplate(templateMatch[1]));
    }
    if (method === "PATCH" && templateMatch) {
      return requireAuth(request, (auth) => handleUpdateTemplate(auth, templateMatch[1], request));
    }
    if (method === "DELETE" && templateMatch) {
      return requireAuth(request, () => handleDeleteTemplate(templateMatch[1]));
    }
    const templateEnableMatch = path.match(/^\/swarm\/recurring\/templates\/([0-9a-f-]{36})\/enable$/);
    if (method === "POST" && templateEnableMatch) {
      return requireAuth(request, () => handleEnableTemplate(templateEnableMatch[1]));
    }
    const templateDisableMatch = path.match(/^\/swarm\/recurring\/templates\/([0-9a-f-]{36})\/disable$/);
    if (method === "POST" && templateDisableMatch) {
      return requireAuth(request, () => handleDisableTemplate(templateDisableMatch[1]));
    }
    // Generator endpoint
    if (method === "POST" && path === "/swarm/recurring/run") {
      return requireAuth(request, (auth) => handleRunGenerator(auth, request));
    }

    return error("Not found", 404);
  } catch (err) {
    console.error("[api] Unhandled error:", err);
    return error("Internal server error", 500);
  }
}

// ============================================================
// BROADCAST WEBHOOK HANDLERS
// ============================================================

// SSE listeners for broadcast events
type BroadcastListener = (event: broadcast.BroadcastEvent) => void;
const broadcastListeners = new Set<{ listener: BroadcastListener; forUser?: string }>();

function broadcastToListeners(event: broadcast.BroadcastEvent): void {
  for (const { listener, forUser } of broadcastListeners) {
    // Check if this listener should receive the event
    if (event.forUsers) {
      const allowedUsers = event.forUsers.split(",").map(u => u.trim().toLowerCase());
      if (forUser && !allowedUsers.includes(forUser.toLowerCase())) {
        continue; // Skip - not in the for_users list
      }
    }
    try {
      listener(event);
    } catch (err) {
      console.error("[broadcast] Listener error:", err);
    }
  }
}

async function handleCreateWebhook(auth: AuthContext, request: Request): Promise<Response> {
  try {
    const body = await request.json() as { appName?: string; title?: string; for?: string };
    
    if (!body.appName || !body.title) {
      return error("appName and title are required", 400);
    }
    
    // Validate appName format
    if (!/^[a-z][a-z0-9_-]*$/.test(body.appName)) {
      return error("appName must start with a letter and contain only lowercase letters, numbers, underscores, and hyphens", 400);
    }
    
    const webhook = await broadcast.createWebhook({
      appName: body.appName,
      title: body.title,
      owner: auth.identity,
      forUsers: body.for,
    });
    
    const ingestUrl = `https://messages.biginformatics.net/api/ingest/${webhook.appName}/${webhook.token}`;
    
    return json({
      ...webhook,
      ingestUrl,
    }, 201);
  } catch (err) {
    console.error("[broadcast] Create webhook error:", err);
    return error(`Failed to create webhook: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
}

async function handleListWebhooks(auth: AuthContext, request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const all = url.searchParams.get("all") === "true" && auth.isAdmin;
    
    const webhooks = await broadcast.listWebhooks(all ? undefined : auth.identity);
    
    return json({
      webhooks: webhooks.map(w => ({
        ...w,
        ingestUrl: `https://messages.biginformatics.net/api/ingest/${w.appName}/${w.token}`,
      })),
    });
  } catch (err) {
    console.error("[broadcast] List webhooks error:", err);
    return error(`Failed to list webhooks: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
}

async function handleGetWebhook(auth: AuthContext, id: number): Promise<Response> {
  try {
    const webhook = await broadcast.getWebhookById(id);
    
    if (!webhook) {
      return error("Webhook not found", 404);
    }
    
    // Only owner or admin can view
    if (webhook.owner !== auth.identity && !auth.isAdmin) {
      return error("Forbidden", 403);
    }
    
    return json({
      ...webhook,
      ingestUrl: `https://messages.biginformatics.net/api/ingest/${webhook.appName}/${webhook.token}`,
    });
  } catch (err) {
    console.error("[broadcast] Get webhook error:", err);
    return error("Failed to get webhook", 500);
  }
}

async function handleWebhookToggle(auth: AuthContext, id: number, enabled: boolean): Promise<Response> {
  try {
    const webhook = await broadcast.getWebhookById(id);
    
    if (!webhook) {
      return error("Webhook not found", 404);
    }
    
    // Only owner or admin can toggle
    if (webhook.owner !== auth.identity && !auth.isAdmin) {
      return error("Forbidden", 403);
    }
    
    const updated = await broadcast.setWebhookEnabled(id, enabled);
    
    return json({
      ...updated,
      ingestUrl: `https://messages.biginformatics.net/api/ingest/${updated!.appName}/${updated!.token}`,
    });
  } catch (err) {
    console.error("[broadcast] Toggle webhook error:", err);
    return error("Failed to toggle webhook", 500);
  }
}

async function handleDeleteWebhook(auth: AuthContext, id: number): Promise<Response> {
  try {
    const webhook = await broadcast.getWebhookById(id);
    
    if (!webhook) {
      return error("Webhook not found", 404);
    }
    
    // Only owner or admin can delete
    if (webhook.owner !== auth.identity && !auth.isAdmin) {
      return error("Forbidden", 403);
    }
    
    await broadcast.deleteWebhook(id);
    
    return json({ ok: true });
  } catch (err) {
    console.error("[broadcast] Delete webhook error:", err);
    return error("Failed to delete webhook", 500);
  }
}

async function handleListBroadcastEvents(auth: AuthContext, request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const appName = url.searchParams.get("app") || undefined;
    const limit = parseInt(url.searchParams.get("limit") || "100");
    
    const events = await broadcast.listEvents({
      appName,
      forUser: auth.identity,
      limit: Math.min(limit, 500),
    });
    
    return json({ events });
  } catch (err) {
    console.error("[broadcast] List events error:", err);
    return error("Failed to list events", 500);
  }
}

// GET /api/buzz - Simple endpoint for agents to check broadcast events
async function handleBuzz(auth: AuthContext, request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const appName = url.searchParams.get("app") || undefined;
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const sinceId = url.searchParams.get("since") ? parseInt(url.searchParams.get("since")!) : undefined;
    
    let events = await broadcast.listEvents({
      appName,
      forUser: auth.identity,
      limit: Math.min(limit, 200),
    });
    
    // Filter by sinceId if provided (only return events newer than this id)
    if (sinceId) {
      events = events.filter(e => e.id > sinceId);
    }
    
    // Register API presence
    lastApiActivity.set(auth.identity, Date.now());
    
    return json({
      events: events.map(e => ({
        id: e.id,
        app: e.appName,
        title: e.title,
        receivedAt: e.receivedAt.toISOString(),
        body: e.bodyJson || e.bodyText,
      })),
    });
  } catch (err) {
    console.error("[buzz] Error:", err);
    return error("Failed to fetch buzz", 500);
  }
}

async function handleWebhookIngest(appName: string, token: string, request: Request): Promise<Response> {
  try {
    const webhook = await broadcast.getWebhookByToken(appName, token);
    
    if (!webhook || !webhook.enabled) {
      return error("Not found", 404);
    }
    
    // Parse body
    const contentType = request.headers.get("content-type") || "";
    let bodyText: string | null = null;
    let bodyJson: unknown | null = null;
    
    const rawBody = await request.text();
    
    // Limit body size (256KB)
    if (rawBody.length > 256 * 1024) {
      return error("Payload too large", 413);
    }
    
    if (contentType.includes("application/json")) {
      try {
        bodyJson = JSON.parse(rawBody);
      } catch {
        bodyText = rawBody;
      }
    } else {
      bodyText = rawBody;
    }
    
    // Record the event
    const event = await broadcast.recordEvent({
      webhookId: webhook.id,
      appName: webhook.appName,
      title: webhook.title,
      forUsers: webhook.forUsers,
      contentType: contentType || null,
      bodyText,
      bodyJson,
    });
    
    console.log(`[broadcast] Received event for ${appName}/${token}: ${event.id}`);
    
    // Broadcast to listeners
    broadcastToListeners(event);
    
    return json({ ok: true, id: event.id });
  } catch (err) {
    console.error("[broadcast] Ingest error:", err);
    return error("Failed to process webhook", 500);
  }
}

// Broadcast UI page
async function handleBroadcastUI(): Promise<Response> {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hive - Buzz</title>
  <style>
    :root {
      --background: #0a0a0a;
      --foreground: #fafafa;
      --card: #18181b;
      --card-foreground: #fafafa;
      --primary: #0ea5e9;
      --primary-foreground: #f0f9ff;
      --secondary: #27272a;
      --secondary-foreground: #fafafa;
      --muted: #27272a;
      --muted-foreground: #a1a1aa;
      --accent: #0ea5e9;
      --accent-foreground: #f0f9ff;
      --border: #27272a;
      --input: #27272a;
      --radius: 8px;
    }
    body.light {
      --background: #fafafa;
      --foreground: #18181b;
      --card: #ffffff;
      --card-foreground: #18181b;
      --primary: #0ea5e9;
      --primary-foreground: #f0f9ff;
      --secondary: #f4f4f5;
      --secondary-foreground: #18181b;
      --muted: #f4f4f5;
      --muted-foreground: #71717a;
      --accent: #0ea5e9;
      --accent-foreground: #f0f9ff;
      --border: #e4e4e7;
      --input: #e4e4e7;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: system-ui, -apple-system, sans-serif; 
      background: var(--background); 
      color: var(--foreground);
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 900px; margin: 0 auto; }
    .header { 
      display: flex; 
      justify-content: space-between; 
      align-items: center; 
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }
    .header h1 { font-size: 1.5rem; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    .nav { display: flex; gap: 12px; align-items: center; }
    .nav a { 
      color: var(--muted-foreground); 
      text-decoration: none; 
      padding: 6px 12px;
      border-radius: var(--radius);
      font-size: 0.875rem;
      height: 36px;
      display: inline-flex;
      align-items: center;
    }
    .nav a:hover { background: var(--secondary); color: var(--foreground); }
    .nav a.active { background: var(--primary); color: var(--primary-foreground); }
    .nav .icon-btn { width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; padding: 0; line-height: 0; background: transparent; border: none; cursor: pointer; color: var(--foreground); opacity: 0.7; }
    .nav .icon-btn:hover { opacity: 1; }
    .nav .icon-btn svg, .theme-toggle svg { width: 18px; height: 18px; display: block; }
    .theme-toggle {
      width: 36px;
      height: 36px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      line-height: 0;
      background: var(--secondary);
      border: none;
      border-radius: var(--radius);
      cursor: pointer;
      color: var(--foreground);
    }
    .filter-bar {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
      flex-wrap: wrap;
      align-items: center;
    }
    .filter-bar select {
      background: var(--card);
      color: var(--foreground);
      border: 1px solid var(--border);
      padding: 8px 12px;
      border-radius: var(--radius);
      font-size: 0.875rem;
    }
    .status-badge {
      padding: 4px 8px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 500;
    }
    .status-badge.connected { background: #22c55e20; color: #22c55e; }
    .status-badge.disconnected { background: #ef444420; color: #ef4444; }
    .events { display: flex; flex-direction: column; gap: 12px; }
    .event-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px;
      cursor: pointer;
      transition: border-color 0.2s;
    }
    .event-card:hover { border-color: var(--primary); }
    .event-card.expanded { border-color: var(--primary); }
    .event-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    .event-title { font-weight: 600; font-size: 0.9375rem; }
    .event-meta { 
      display: flex; 
      gap: 12px; 
      margin-top: 8px; 
      font-size: 0.8125rem; 
      color: var(--muted-foreground);
    }
    .event-app { 
      background: var(--secondary); 
      padding: 2px 8px; 
      border-radius: 4px;
      font-family: monospace;
      font-size: 0.75rem;
    }
    .event-body {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--border);
      display: none;
    }
    .event-card.expanded .event-body { display: block; }
    .event-body pre {
      background: var(--secondary);
      padding: 12px;
      border-radius: var(--radius);
      overflow-x: auto;
      font-size: 0.8125rem;
      font-family: monospace;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--muted-foreground);
    }
    .empty-state svg { width: 48px; height: 48px; margin-bottom: 16px; opacity: 0.5; }
    .new-event {
      animation: highlight 2s ease-out;
    }
    @keyframes highlight {
      from { background: var(--primary); }
      to { background: var(--card); }
    }
    /* Presence indicators */
    #presenceIndicators { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; }
    .presence-avatar { position: relative; width: 28px; height: 28px; flex-shrink: 0; }
    .presence-avatar img, .presence-avatar .avatar-placeholder { width: 28px; height: 28px; border-radius: 50%; font-size: 11px; opacity: 0.5; transition: opacity 0.2s ease; }
    .presence-avatar img { object-fit: cover; }
    .presence-avatar .avatar-placeholder { display: flex; align-items: center; justify-content: center; font-weight: 600; }
    .presence-avatar.online img, .presence-avatar.online .avatar-placeholder { opacity: 1; }
    .presence-avatar .ring { position: absolute; inset: -2px; border-radius: 50%; border: 2px solid transparent; transition: all 0.2s ease; }
    .presence-avatar.online .ring { border-color: #22c55e; box-shadow: 0 0 8px rgba(34,197,94,0.4); }
    body.light .presence-avatar img, body.light .presence-avatar .avatar-placeholder { opacity: 0.65; }
    body.light .presence-avatar.online img, body.light .presence-avatar.online .avatar-placeholder { opacity: 1; }
    body.light .presence-avatar.online .ring { border-color: #16a34a; box-shadow: 0 0 8px rgba(22,163,74,0.4); }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/></svg>
        Buzz
      </h1>
      <div class="nav">
        <a href="/ui">Messages</a>
        <a href="/ui/buzz" class="active">Buzz</a>
        <button id="keyBtn" class="icon-btn" onclick="toggleKeyPopover()" title="Enter mailbox key">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4Z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg>
        </button>
        <div id="keyPopover" style="display:none;position:absolute;top:50px;right:80px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:12px;z-index:1000;box-shadow:0 4px 12px rgba(0,0,0,0.3);">
          <input id="keyInput" type="text" placeholder="Enter mailbox key" style="width:180px;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--background);color:var(--foreground);margin-bottom:8px;">
          <div style="display:flex;gap:8px;">
            <button onclick="submitKey()" style="flex:1;padding:6px 12px;background:var(--primary);color:white;border:none;border-radius:var(--radius);cursor:pointer;">Go</button>
            <button onclick="toggleKeyPopover()" style="padding:6px 12px;background:transparent;border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;color:var(--foreground);">Cancel</button>
          </div>
        </div>
        <button id="themeToggle" class="theme-toggle" onclick="toggleTheme()" title="Toggle theme"></button>
      </div>
    </div>
    <div id="presenceIndicators"></div>
    
    <div class="filter-bar">
      <select id="appFilter" onchange="applyFilter()">
        <option value="">All Apps</option>
      </select>
      <span id="connectionStatus" class="status-badge disconnected">Disconnected</span>
    </div>
    
    <div id="events" class="events">
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/></svg>
        <p>No broadcast events yet</p>
        <p style="font-size: 0.8125rem; margin-top: 8px;">Events from webhooks will appear here in real-time</p>
      </div>
    </div>
  </div>
  
  <script>
    let events = [];
    let eventSource = null;
    let currentFilter = '';
    let expandedEventId = null;
    
    function toggleExpand(id) {
      expandedEventId = (expandedEventId === id) ? null : id;
      renderEvents();
    }
    
    // Theme handling
    const sunIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
    const moonIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
    
    function updateThemeIcon() {
      const btn = document.getElementById('themeToggle');
      if (btn) btn.innerHTML = document.body.classList.contains('light') ? moonIcon : sunIcon;
    }
    
    const savedTheme = localStorage.getItem('theme') || 'dark';
    if (savedTheme === 'light') document.body.classList.add('light');
    updateThemeIcon();
    
    function toggleTheme() {
      document.body.classList.toggle('light');
      localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark');
      updateThemeIcon();
    }
    
    // Check if logged in and update nav
    const bellIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
    const storedKey = localStorage.getItem('hive_mailbox_key');
    if (storedKey) {
      // Replace key button with logout + bell
      const keyBtn = document.getElementById('keyBtn');
      const keyPopover = document.getElementById('keyPopover');
      if (keyBtn) {
        // Create logout button
        const logoutBtn = document.createElement('button');
        logoutBtn.onclick = function() { localStorage.removeItem('hive_mailbox_key'); window.location.href = '/ui'; };
        logoutBtn.style.cssText = 'color:var(--muted-foreground);padding:6px 12px;border-radius:var(--radius);font-size:0.875rem;background:transparent;border:1px solid var(--border);cursor:pointer;';
        logoutBtn.textContent = 'Logout';
        
        // Create bell button (same styling as key button)
        const bellBtn = document.createElement('button');
        bellBtn.id = 'soundToggle';
        bellBtn.className = 'icon-btn';
        bellBtn.onclick = function() {}; // No sound on Buzz page
        bellBtn.title = 'Notifications (Messages only)';
        bellBtn.innerHTML = bellIcon;
        
        // Insert before key button, then remove key
        keyBtn.parentNode.insertBefore(logoutBtn, keyBtn);
        keyBtn.parentNode.insertBefore(bellBtn, keyBtn);
        keyBtn.remove();
        if (keyPopover) keyPopover.remove();
      }
    }
    
    // Key popover
    function toggleKeyPopover() {
      const popover = document.getElementById('keyPopover');
      const input = document.getElementById('keyInput');
      if (popover.style.display === 'none') {
        popover.style.display = 'block';
        input.focus();
      } else {
        popover.style.display = 'none';
      }
    }
    
    function submitKey() {
      const key = document.getElementById('keyInput').value.trim();
      if (key) {
        localStorage.setItem('hive_mailbox_key', key);
        window.location.href = '/ui/' + encodeURIComponent(key);
      }
    }
    
    document.addEventListener('keydown', function(e) {
      if (document.getElementById('keyPopover').style.display !== 'none') {
        if (e.key === 'Enter') submitKey();
        if (e.key === 'Escape') toggleKeyPopover();
      }
    });
    
    // Presence
    const avatarColors = {
      chris: { bg: '#4f46e5', fg: '#fff' },
      clio: { bg: '#0d9488', fg: '#fff' },
      domingo: { bg: '#dc2626', fg: '#fff' },
      zumie: { bg: '#f59e0b', fg: '#fff' }
    };
    
    // Avatar images (same as Messages UI)
    const avatarData = {
      chris: '/ui/assets/avatars/chris.jpg',
      clio: '/ui/assets/avatars/clio.png',
      domingo: '/ui/assets/avatars/domingo.jpg',
      zumie: '/ui/assets/avatars/zumie.png'
    }
    
    function renderPresence(presence) {
      const container = document.getElementById('presenceIndicators');
      container.innerHTML = presence.map(info => {
        const colors = avatarColors[info.user] || { bg: '#333', fg: '#888' };
        const initial = info.user[0].toUpperCase();
        const status = info.online ? 'online' : 'offline';
        const avatar = avatarData[info.user];
        // Use same <img> approach as Messages for consistency
        const avatarHtml = avatar
          ? \`<img class="avatar" src="\${avatar}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">\`
          : '';
        const fallbackStyle = avatar ? 'display:none' : '';
        return \`
          <div class="presence-avatar\${info.online ? ' online' : ''}" title="\${info.user} - \${status}">
            <div class="ring"></div>
            \${avatarHtml}
            <div class="avatar-placeholder" style="background:\${colors.bg};color:\${colors.fg};\${fallbackStyle}">\${initial}</div>
          </div>
        \`;
      }).join('');
    }
    
    // Fetch presence from Messages SSE (shared)
    async function loadPresence() {
      try {
        const res = await fetch('/ui/stream', { headers: { Accept: 'text/event-stream' } });
        // Just get initial presence from a quick connection
      } catch(e) {}
    }
    
    // Simple presence fetch from main UI stream init
    const presenceSource = new EventSource('/ui/stream');
    presenceSource.addEventListener('presence', (e) => {
      const data = JSON.parse(e.data);
      renderPresence(data.presence);
    });
    presenceSource.addEventListener('init', (e) => {
      const data = JSON.parse(e.data);
      if (data.presence) renderPresence(data.presence);
    });
    
    function formatTime(date) {
      return new Date(date).toLocaleString();
    }
    
    function renderEvents() {
      const container = document.getElementById('events');
      const filtered = currentFilter 
        ? events.filter(e => e.appName === currentFilter)
        : events;
      
      // Clear expanded state if the event no longer exists
      if (expandedEventId && !events.find(e => e.id === expandedEventId)) {
        expandedEventId = null;
      }
      
      // Auto-expand first item if nothing is expanded
      if (!expandedEventId && filtered.length > 0) {
        expandedEventId = filtered[0].id;
      }
      
      if (filtered.length === 0) {
        container.innerHTML = \`
          <div class="empty-state">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/></svg>
            <p>\${currentFilter ? 'No events for this app' : 'No broadcast events yet'}</p>
            <p style="font-size: 0.8125rem; margin-top: 8px;">Events from webhooks will appear here in real-time</p>
          </div>
        \`;
        return;
      }
      
      container.innerHTML = filtered.map(e => \`
        <div class="event-card\${expandedEventId === e.id ? ' expanded' : ''}" onclick="toggleExpand('\${e.id}')">
          <div class="event-header">
            <div>
              <div class="event-title">\${escapeHtml(e.title)}</div>
              <div class="event-meta">
                <span class="event-app">\${escapeHtml(e.appName)}</span>
                <span>\${formatTime(e.receivedAt)}</span>
                \${e.forUsers ? '<span>For: ' + escapeHtml(e.forUsers) + '</span>' : ''}
              </div>
            </div>
          </div>
          <div class="event-body">
            <pre>\${e.bodyJson ? JSON.stringify(e.bodyJson, null, 2) : escapeHtml(e.bodyText || '(empty)')}</pre>
          </div>
        </div>
      \`).join('');
    }
    
    function escapeHtml(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    function updateAppFilter() {
      const apps = [...new Set(events.map(e => e.appName))].sort();
      const select = document.getElementById('appFilter');
      const currentValue = select.value;
      
      select.innerHTML = '<option value="">All Apps</option>' + 
        apps.map(a => \`<option value="\${a}">\${a}</option>\`).join('');
      
      if (apps.includes(currentValue)) {
        select.value = currentValue;
      }
    }
    
    function applyFilter() {
      currentFilter = document.getElementById('appFilter').value;
      renderEvents();
    }
    
    function setStatus(connected) {
      const badge = document.getElementById('connectionStatus');
      badge.textContent = connected ? 'Connected' : 'Disconnected';
      badge.className = 'status-badge ' + (connected ? 'connected' : 'disconnected');
    }
    
    function connect() {
      eventSource = new EventSource('/ui/buzz/stream');
      
      eventSource.onopen = () => setStatus(true);
      eventSource.onerror = () => {
        setStatus(false);
        eventSource.close();
        setTimeout(connect, 3000);
      };
      
      eventSource.addEventListener('init', (e) => {
        const data = JSON.parse(e.data);
        events = data.events || [];
        updateAppFilter();
        renderEvents();
      });
      
      eventSource.addEventListener('event', (e) => {
        const event = JSON.parse(e.data);
        events.unshift(event);
        if (events.length > 500) events.pop();
        updateAppFilter();
        renderEvents();
        
        // Highlight new event
        const first = document.querySelector('.event-card');
        if (first) {
          first.classList.add('new-event');
          setTimeout(() => first.classList.remove('new-event'), 2000);
        }
      });
    }
    
    connect();
  </script>
<!-- build: img-avatars-v3 -->
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
}

// Broadcast SSE stream for UI
function handleBroadcastUIStream(request: Request): Response {
  const url = new URL(request.url);
  const viewer = url.searchParams.get("viewer")?.toLowerCase();
  
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      
      // Send initial events
      const initialEvents = await broadcast.listEvents({ forUser: viewer, limit: 100 });
      controller.enqueue(encoder.encode(`event: init\ndata: ${JSON.stringify({ events: initialEvents })}\n\n`));
      
      // Listen for new events
      const listenerEntry = {
        listener: (event: broadcast.BroadcastEvent) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`event: event\ndata: ${JSON.stringify(event)}\n\n`));
          } catch {
            closed = true;
          }
        },
        forUser: viewer,
      };
      broadcastListeners.add(listenerEntry);
      
      // Ping every 30 seconds
      const pingInterval = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          closed = true;
          clearInterval(pingInterval);
        }
      }, 30000);
      
      // Cleanup
      return () => {
        closed = true;
        clearInterval(pingInterval);
        broadcastListeners.delete(listenerEntry);
      };
    },
  });
  
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

// ============================================================
// SWARM UI - Task Management Interface
// ============================================================

async function handleSwarmUI(): Promise<Response> {
  // Public Swarm requires login - redirect to main UI
  return Response.redirect("/ui", 302);
}

// Legacy inline HTML version - keeping for reference, now using renderSwarmHTML
function _legacySwarmHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hive - Swarm</title>
  <style>
    :root {
      --background: #0a0a0a;
      --foreground: #fafafa;
      --card: #18181b;
      --card-foreground: #fafafa;
      --primary: #0ea5e9;
      --primary-foreground: #f0f9ff;
      --secondary: #27272a;
      --secondary-foreground: #fafafa;
      --muted: #27272a;
      --muted-foreground: #a1a1aa;
      --accent: #0ea5e9;
      --accent-foreground: #f0f9ff;
      --border: #27272a;
      --input: #27272a;
      --radius: 8px;
    }
    body.light {
      --background: #fafafa;
      --foreground: #18181b;
      --card: #ffffff;
      --card-foreground: #18181b;
      --primary: #0ea5e9;
      --primary-foreground: #f0f9ff;
      --secondary: #f4f4f5;
      --secondary-foreground: #18181b;
      --muted: #f4f4f5;
      --muted-foreground: #71717a;
      --accent: #0ea5e9;
      --accent-foreground: #f0f9ff;
      --border: #e4e4e7;
      --input: #e4e4e7;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: system-ui, -apple-system, sans-serif; 
      background: var(--background); 
      color: var(--foreground);
      min-height: 100vh;
    }
    .layout { display: flex; min-height: 100vh; }
    .sidebar { 
      width: 240px; 
      border-right: 1px solid var(--border); 
      padding: 20px;
      flex-shrink: 0;
    }
    .main { flex: 1; display: flex; flex-direction: column; }
    .header { 
      display: flex; 
      justify-content: space-between; 
      align-items: center; 
      padding: 16px 24px;
      border-bottom: 1px solid var(--border);
    }
    .header h1 { font-size: 1.25rem; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    .nav { display: flex; gap: 8px; align-items: center; }
    .nav a { 
      color: var(--muted-foreground); 
      text-decoration: none; 
      padding: 6px 12px;
      border-radius: var(--radius);
      font-size: 0.875rem;
      height: 36px;
      display: inline-flex;
      align-items: center;
    }
    .nav a:hover { background: var(--secondary); color: var(--foreground); }
    .nav a.active { background: var(--primary); color: var(--primary-foreground); }
    .nav .icon-btn { 
      width: 36px; height: 36px; 
      display: inline-flex; align-items: center; justify-content: center; 
      padding: 0; line-height: 0; 
      background: transparent; border: none; 
      cursor: pointer; color: var(--foreground); opacity: 0.7; 
    }
    .nav .icon-btn:hover { opacity: 1; }
    .nav .icon-btn svg, .theme-toggle svg { width: 18px; height: 18px; display: block; }
    .theme-toggle {
      width: 36px; height: 36px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--secondary); border: none; border-radius: var(--radius);
      cursor: pointer; color: var(--foreground);
    }
    .content { flex: 1; padding: 24px; overflow-y: auto; }
    
    /* Filter sidebar */
    .filter-section { margin-bottom: 24px; }
    .filter-section h3 { 
      font-size: 0.75rem; 
      text-transform: uppercase; 
      color: var(--muted-foreground); 
      margin-bottom: 8px;
      letter-spacing: 0.05em;
    }
    .filter-option { 
      display: flex; 
      align-items: center; 
      gap: 8px; 
      padding: 6px 8px;
      border-radius: var(--radius);
      cursor: pointer;
      font-size: 0.875rem;
    }
    .filter-option:hover { background: var(--secondary); }
    .filter-option input { cursor: pointer; accent-color: var(--primary); }
    .filter-option.checked { background: var(--secondary); }
    
    /* Task list */
    .task-list { display: flex; flex-direction: column; gap: 8px; }
    .task-card { 
      background: var(--card); 
      border: 1px solid var(--border); 
      border-radius: var(--radius);
      padding: 16px;
      display: flex;
      gap: 12px;
      cursor: pointer;
      transition: border-color 0.15s;
    }
    .task-card:hover { border-color: var(--primary); }
    .task-card.selected { border-color: var(--primary); background: rgba(14, 165, 233, 0.05); }
    .task-accent { width: 4px; border-radius: 2px; flex-shrink: 0; }
    .task-content { flex: 1; min-width: 0; }
    .task-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    .task-title { font-weight: 500; margin-bottom: 4px; }
    .task-meta { font-size: 0.8125rem; color: var(--muted-foreground); display: flex; gap: 12px; flex-wrap: wrap; }
    .task-badges { display: flex; gap: 6px; flex-shrink: 0; }
    .badge { 
      font-size: 0.6875rem; 
      padding: 2px 8px; 
      border-radius: 999px; 
      font-weight: 500;
      text-transform: uppercase;
    }
    .badge-queued { background: var(--secondary); color: var(--muted-foreground); }
    .badge-ready { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
    .badge-in_progress { background: rgba(14, 165, 233, 0.15); color: #0ea5e9; }
    .badge-holding { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
    .badge-review { background: rgba(168, 85, 247, 0.15); color: #a855f7; }
    .badge-complete { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
    .badge-blocked { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
    
    /* Quick actions */
    .task-actions { 
      display: none; 
      gap: 4px; 
      margin-top: 8px;
    }
    .task-card:hover .task-actions { display: flex; }
    .action-btn { 
      font-size: 0.75rem; 
      padding: 4px 8px; 
      border-radius: var(--radius);
      border: 1px solid var(--border);
      background: var(--background);
      color: var(--foreground);
      cursor: pointer;
    }
    .action-btn:hover { background: var(--secondary); }
    .action-btn.primary { background: var(--primary); color: white; border-color: var(--primary); }
    
    /* Empty state */
    .empty-state { 
      text-align: center; 
      padding: 60px 20px; 
      color: var(--muted-foreground);
    }
    .empty-state h3 { font-size: 1rem; margin-bottom: 8px; color: var(--foreground); }
    
    /* Create task form */
    .create-form { 
      background: var(--card); 
      border: 1px solid var(--border); 
      border-radius: var(--radius);
      padding: 16px;
      margin-bottom: 16px;
    }
    .create-form input, .create-form select, .create-form textarea { 
      width: 100%;
      padding: 8px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--background);
      color: var(--foreground);
      font-size: 0.875rem;
      margin-bottom: 12px;
    }
    .create-form textarea { min-height: 80px; resize: vertical; }
    .form-row { display: flex; gap: 12px; }
    .form-row > * { flex: 1; }
    .create-btn { 
      background: var(--primary); 
      color: white; 
      border: none; 
      padding: 8px 16px;
      border-radius: var(--radius);
      cursor: pointer;
      font-size: 0.875rem;
      font-weight: 500;
    }
    .create-btn:hover { opacity: 0.9; }
    
    /* Status colors */
    body.light .badge-queued { background: #f4f4f5; color: #71717a; }
    body.light .badge-ready { background: rgba(34, 197, 94, 0.1); color: #16a34a; }
    body.light .badge-in_progress { background: rgba(14, 165, 233, 0.1); color: #0284c7; }
    body.light .badge-holding { background: rgba(245, 158, 11, 0.1); color: #d97706; }
    body.light .badge-review { background: rgba(168, 85, 247, 0.1); color: #9333ea; }
    body.light .badge-blocked { background: rgba(239, 68, 68, 0.1); color: #dc2626; }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="filter-section">
        <h3>Status</h3>
        <label class="filter-option checked"><input type="checkbox" checked data-filter="status" value="queued"> Queued</label>
        <label class="filter-option checked"><input type="checkbox" checked data-filter="status" value="ready"> Ready</label>
        <label class="filter-option checked"><input type="checkbox" checked data-filter="status" value="in_progress"> In Progress</label>
        <label class="filter-option checked"><input type="checkbox" checked data-filter="status" value="holding"> Holding</label>
        <label class="filter-option checked"><input type="checkbox" checked data-filter="status" value="review"> Review</label>
        <label class="filter-option"><input type="checkbox" data-filter="status" value="complete"> Complete</label>
      </div>
      <div class="filter-section">
        <h3>Assignee</h3>
        <label class="filter-option checked"><input type="checkbox" checked data-filter="assignee" value="unassigned"> Unassigned</label>
        <label class="filter-option checked"><input type="checkbox" checked data-filter="assignee" value="chris"> Chris</label>
        <label class="filter-option checked"><input type="checkbox" checked data-filter="assignee" value="clio"> Clio</label>
        <label class="filter-option checked"><input type="checkbox" checked data-filter="assignee" value="domingo"> Domingo</label>
        <label class="filter-option checked"><input type="checkbox" checked data-filter="assignee" value="zumie"> Zumie</label>
      </div>
      <div class="filter-section">
        <h3>Project</h3>
        <label class="filter-option checked"><input type="checkbox" checked data-filter="project" value="none"> No Project</label>
        ${projects.map(p => '<label class="filter-option checked"><input type="checkbox" checked data-filter="project" value="' + p.id + '"> <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + p.color + ';margin-right:4px;"></span>' + p.title + '</label>').join('')}
      </div>
      <div class="filter-section">
        <h3>Sort</h3>
        <select id="sortSelect" onchange="applyFilters()" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--background);color:var(--foreground);font-size:0.875rem;">
          <option value="planned">Planned (default)</option>
          <option value="createdAt-desc">Created (newest)</option>
          <option value="createdAt-asc">Created (oldest)</option>
          <option value="updatedAt-desc">Updated (newest)</option>
          <option value="updatedAt-asc">Updated (oldest)</option>
        </select>
      </div>
      <div class="filter-section">
        <h3>Options</h3>
        <label class="filter-option"><input type="checkbox" id="showFuture" onchange="applyFilters()"> Show future tasks</label>
      </div>
    </aside>
    <main class="main">
      <header class="header">
        <h1>${ICONS.swarm} Swarm</h1>
        <nav class="nav">
          <a href="/ui">Messages</a>
          <a href="/ui/buzz">Buzz</a>
          <a href="/ui/swarm" class="active">Swarm</a>
          <button class="theme-toggle" onclick="toggleTheme()" title="Toggle theme">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
          </button>
        </nav>
      </header>
      <div class="content">
        <div class="create-form" id="createForm" style="display:none;">
          <input type="text" id="newTaskTitle" placeholder="Task title..." />
          <div class="form-row">
            <select id="newTaskProject">
              <option value="">No project</option>
              ${projects.map(p => '<option value="' + p.id + '">' + p.title + '</option>').join('')}
            </select>
            <select id="newTaskAssignee">
              <option value="">Unassigned</option>
              <option value="chris">Chris</option>
              <option value="clio">Clio</option>
              <option value="domingo">Domingo</option>
              <option value="zumie">Zumie</option>
            </select>
          </div>
          <textarea id="newTaskDetail" placeholder="Details (optional)..."></textarea>
          <input type="url" id="newTaskIssueUrl" placeholder="Issue URL (GitHub, OneDev, etc.)..." style="margin-top:8px;">
          <div class="form-row" style="margin-top:8px;">
            <label style="display:flex;align-items:center;gap:8px;font-size:0.8rem;color:var(--muted-foreground);">
              <span>Start after:</span>
              <input type="datetime-local" id="newTaskOnOrAfter" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--background);color:var(--foreground);font-size:0.8rem;">
            </label>
          </div>
          <button class="create-btn" onclick="createTask()">Create Task</button>
        </div>
        <button class="action-btn" onclick="toggleCreateForm()" style="margin-bottom:16px;">+ New Task</button>
        <div class="task-list" id="taskList">
          ${enrichedTasks.length === 0 ? '<div class="empty-state"><h3>No tasks yet</h3><p>Create your first task to get started</p></div>' : 
            enrichedTasks.map(t => renderTaskCard(t, projects, enrichedTasks)).join('')}
        </div>
      </div>
    </main>
  </div>
  <script>
    // Theme
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') document.body.classList.add('light');
    function toggleTheme() {
      document.body.classList.toggle('light');
      localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark');
    }
    
    // Create form toggle
    function toggleCreateForm() {
      const form = document.getElementById('createForm');
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
    }
    
    // Filter handling
    document.querySelectorAll('[data-filter]').forEach(cb => {
      cb.addEventListener('change', () => {
        cb.closest('.filter-option').classList.toggle('checked', cb.checked);
        applyFilters();
      });
    });
    
    function applyFilters() {
      const statuses = [...document.querySelectorAll('[data-filter="status"]:checked')].map(cb => cb.value);
      const assignees = [...document.querySelectorAll('[data-filter="assignee"]:checked')].map(cb => cb.value);
      const projects = [...document.querySelectorAll('[data-filter="project"]:checked')].map(cb => cb.value);
      const showFuture = document.getElementById('showFuture')?.checked || false;
      const sortValue = document.getElementById('sortSelect')?.value || 'planned';
      
      // Filter cards
      document.querySelectorAll('.task-card').forEach(card => {
        const status = card.dataset.status;
        const assignee = card.dataset.assignee || 'unassigned';
        const project = card.dataset.project || 'none';
        const isFuture = card.dataset.future === 'true';
        
        const statusMatch = statuses.includes(status);
        const assigneeMatch = assignees.includes(assignee);
        const projectMatch = projects.includes(project);
        const futureMatch = showFuture || !isFuture;
        
        card.style.display = (statusMatch && assigneeMatch && projectMatch && futureMatch) ? 'flex' : 'none';
      });
      
      // Sort cards
      const taskList = document.getElementById('taskList');
      const cards = [...taskList.querySelectorAll('.task-card')];
      const statusOrder = { in_progress: 1, review: 2, ready: 3, queued: 4, holding: 5, complete: 6 };
      
      cards.sort((a, b) => {
        if (sortValue === 'planned') {
          const statusA = statusOrder[a.dataset.status] || 99;
          const statusB = statusOrder[b.dataset.status] || 99;
          if (statusA !== statusB) return statusA - statusB;
          const sortKeyA = parseInt(a.dataset.sortKey) || 0;
          const sortKeyB = parseInt(b.dataset.sortKey) || 0;
          if (sortKeyA !== sortKeyB) return sortKeyA - sortKeyB;
          return parseInt(a.dataset.created) - parseInt(b.dataset.created);
        } else if (sortValue === 'createdAt-desc') {
          return parseInt(b.dataset.created) - parseInt(a.dataset.created);
        } else if (sortValue === 'createdAt-asc') {
          return parseInt(a.dataset.created) - parseInt(b.dataset.created);
        } else if (sortValue === 'updatedAt-desc') {
          return parseInt(b.dataset.updated) - parseInt(a.dataset.updated);
        } else if (sortValue === 'updatedAt-asc') {
          return parseInt(a.dataset.updated) - parseInt(b.dataset.updated);
        }
        return 0;
      });
      cards.forEach(card => taskList.appendChild(card));
    }
    
    // Task actions
    async function claimTask(id) {
      await fetch('/api/swarm/tasks/' + id + '/claim', { method: 'POST' });
      location.reload();
    }
    
    async function updateStatus(id, status) {
      await fetch('/api/swarm/tasks/' + id + '/status', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      location.reload();
    }
    
    async function moveTask(id, direction) {
      const cards = [...document.querySelectorAll('.task-card')].filter(c => c.style.display !== 'none');
      const idx = cards.findIndex(c => c.dataset.id === id);
      if (idx === -1) return;
      
      let beforeTaskId = null;
      if (direction === 'up' && idx > 0) {
        // Move before the previous visible card
        beforeTaskId = cards[idx - 1].dataset.id;
      } else if (direction === 'down' && idx < cards.length - 1) {
        // Move before the card after the next one (or null if moving to end)
        beforeTaskId = idx + 2 < cards.length ? cards[idx + 2].dataset.id : null;
      } else {
        return; // Can't move further
      }
      
      await fetch('/api/swarm/tasks/' + id + '/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beforeTaskId })
      });
      location.reload();
    }
    
    async function createTask() {
      const title = document.getElementById('newTaskTitle').value.trim();
      if (!title) return alert('Title is required');
      
      const projectId = document.getElementById('newTaskProject').value || null;
      const assigneeUserId = document.getElementById('newTaskAssignee').value || null;
      const detail = document.getElementById('newTaskDetail').value.trim() || null;
      const issueUrl = document.getElementById('newTaskIssueUrl').value.trim() || null;
      const onOrAfterInput = document.getElementById('newTaskOnOrAfter').value;
      const onOrAfterAt = onOrAfterInput ? new Date(onOrAfterInput).toISOString() : null;
      
      await fetch('/api/swarm/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, projectId, assigneeUserId, detail, issueUrl, onOrAfterAt })
      });
      location.reload();
    }
  </script>
</body>
</html>`;
}

function renderTaskCard(t: swarm.SwarmTask, projects: swarm.SwarmProject[], allTasks: swarm.SwarmTask[]): string {
  const project = projects.find(p => p.id === t.projectId);
  const accentColor = project?.color || '#71717a';
  
  const projectSpan = project ? '<span>' + project.title + '</span>' : '';
  const assigneeSpan = t.assigneeUserId ? '<span>@' + t.assigneeUserId + '</span>' : '<span>Unassigned</span>';
  const afterSpan = t.onOrAfterAt ? '<span>After ' + new Date(t.onOrAfterAt).toLocaleDateString() + '</span>' : '';
  const blockedBadge = t.blockedReason ? '<span class="badge badge-blocked">Blocked</span>' : '';
  
  const claimBtn = !t.assigneeUserId ? '<button class="action-btn" onclick="event.stopPropagation();claimTask(\'' + t.id + '\')">Claim</button>' : '';
  const readyBtn = t.status === 'queued' ? '<button class="action-btn" onclick="event.stopPropagation();updateStatus(\'' + t.id + '\', \'ready\')">Ready</button>' : '';
  const startBtn = t.status === 'ready' && !t.blockedReason ? '<button class="action-btn primary" onclick="event.stopPropagation();updateStatus(\'' + t.id + '\', \'in_progress\')">Start</button>' : '';
  const reviewBtn = t.status === 'in_progress' ? '<button class="action-btn" onclick="event.stopPropagation();updateStatus(\'' + t.id + '\', \'review\')">Review</button>' : '';
  const holdBtn = t.status === 'in_progress' ? '<button class="action-btn" onclick="event.stopPropagation();updateStatus(\'' + t.id + '\', \'holding\')">Hold</button>' : '';
  const completeBtn = t.status === 'review' ? '<button class="action-btn primary" onclick="event.stopPropagation();updateStatus(\'' + t.id + '\', \'complete\')">Complete</button>' : '';
  
  // Format dates
  const createdAt = new Date(t.createdAt).toLocaleString();
  const updatedAt = new Date(t.updatedAt).toLocaleString();
  
  // Project options for dropdown
  const projectOptions = '<option value="">No Project</option>' + 
    projects.map(p => '<option value="' + p.id + '"' + (p.id === t.projectId ? ' selected' : '') + '>' + escapeHtml(p.title) + '</option>').join('');
  
  // Assignee options
  const assigneeOptions = '<option value="">Unassigned</option>' +
    ['chris', 'clio', 'domingo', 'zumie'].map(a => '<option value="' + a + '"' + (a === t.assigneeUserId ? ' selected' : '') + '>' + a + '</option>').join('');
  
  // Dependency options (other tasks, excluding self and complete tasks)
  const dependencyOptions = '<option value="">None</option>' +
    allTasks
      .filter(other => other.id !== t.id && other.status !== 'complete')
      .map(other => '<option value="' + other.id + '"' + (other.id === t.mustBeDoneAfterTaskId ? ' selected' : '') + '>' + escapeHtml(other.title).substring(0, 40) + (other.title.length > 40 ? '...' : '') + '</option>')
      .join('');
  
  // Next task options (other tasks, excluding self)
  const nextTaskOptions = '<option value="">None</option>' +
    allTasks
      .filter(other => other.id !== t.id)
      .map(other => '<option value="' + other.id + '"' + (other.id === t.nextTaskId ? ' selected' : '') + '>' + escapeHtml(other.title).substring(0, 40) + (other.title.length > 40 ? '...' : '') + '</option>')
      .join('');
  
  // Find next task for display
  const nextTask = t.nextTaskId ? allTasks.find(other => other.id === t.nextTaskId) : null;
  const nextSpan = nextTask ? '<span style="color:var(--muted-foreground);font-size:0.75rem;">→ ' + escapeHtml(nextTask.title).substring(0, 20) + (nextTask.title.length > 20 ? '...' : '') + '</span>' : '';
  
  const isFuture = t.onOrAfterAt && new Date(t.onOrAfterAt) > new Date();
  
  return '<div class="task-card" data-id="' + t.id + '" data-status="' + t.status + '" data-assignee="' + (t.assigneeUserId || '') + '" data-project="' + (t.projectId || '') + '" data-future="' + (isFuture ? 'true' : 'false') + '" data-created="' + new Date(t.createdAt).getTime() + '" data-updated="' + new Date(t.updatedAt).getTime() + '" data-sort-key="' + (t.sortKey || 0) + '" onclick="toggleTaskExpand(this)">' +
    '<div class="task-accent" style="background:' + accentColor + '"></div>' +
    '<div class="task-content">' +
      '<div class="task-header">' +
        '<div>' +
          '<div class="task-title">' + escapeHtml(t.title) + '</div>' +
          '<div class="task-meta">' + projectSpan + assigneeSpan + afterSpan + nextSpan + '</div>' +
        '</div>' +
        '<div class="task-badges">' + blockedBadge + '<span class="badge badge-' + t.status + '">' + t.status.replace('_', ' ') + '</span></div>' +
        (t.issueUrl ? '<div class="task-issue-links" onclick="event.stopPropagation()" style="display:flex;gap:4px;align-items:center;margin-left:8px;"><a href="' + escapeHtml(t.issueUrl) + '" target="_blank" rel="noopener" style="color:var(--muted-foreground);display:inline-flex;align-items:center;padding:4px;" title="Open issue"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a><button onclick="copyUrl(\'' + escapeHtml(t.issueUrl).replace(/'/g, "\\'") + '\', this)" style="background:none;border:none;cursor:pointer;color:var(--muted-foreground);padding:4px;display:inline-flex;align-items:center;" title="Copy URL"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button></div>' : '') +
      '</div>' +
      '<div class="task-detail" onclick="event.stopPropagation()">' +
        '<div class="task-detail-row"><span class="task-detail-label">Title:</span><input type="text" class="task-edit-input" id="edit-title-' + t.id + '" value="' + escapeHtml(t.title).replace(/"/g, '&quot;') + '" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--background);color:var(--foreground);font-size:0.875rem;"></div>' +
        '<div class="task-detail-row"><span class="task-detail-label">Project:</span><select id="edit-project-' + t.id + '" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--background);color:var(--foreground);font-size:0.875rem;">' + projectOptions + '</select></div>' +
        '<div class="task-detail-row"><span class="task-detail-label">Assignee:</span><select id="edit-assignee-' + t.id + '" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--background);color:var(--foreground);font-size:0.875rem;">' + assigneeOptions + '</select></div>' +
        '<div class="task-detail-row"><span class="task-detail-label">Must be done after:</span><select id="edit-dependency-' + t.id + '" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--background);color:var(--foreground);font-size:0.875rem;">' + dependencyOptions + '</select></div>' +
        '<div class="task-detail-row"><span class="task-detail-label">Next task:</span><select id="edit-nextTask-' + t.id + '" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--background);color:var(--foreground);font-size:0.875rem;">' + nextTaskOptions + '</select></div>' +
        '<div class="task-detail-row"><span class="task-detail-label">Start after:</span><input type="datetime-local" id="edit-onOrAfter-' + t.id + '" value="' + (t.onOrAfterAt ? new Date(t.onOrAfterAt).toISOString().slice(0, 16) : '') + '" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--background);color:var(--foreground);font-size:0.875rem;"></div>' +
        '<div class="task-detail-row"><span class="task-detail-label">Issue URL:</span><input type="url" id="edit-issueUrl-' + t.id + '" value="' + (t.issueUrl ? escapeHtml(t.issueUrl) : '') + '" placeholder="GitHub, OneDev, etc." style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--background);color:var(--foreground);font-size:0.875rem;"></div>' +
        (t.issueUrl ? '<div class="task-detail-row"><span class="task-detail-label"></span><span style="display:flex;align-items:center;gap:8px;"><a href="' + escapeHtml(t.issueUrl) + '" target="_blank" rel="noopener" style="color:var(--primary);display:inline-flex;align-items:center;" title="Open issue"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a><button onclick="event.preventDefault();copyUrl(\'' + escapeHtml(t.issueUrl).replace(/'/g, "\\'") + '\', this)" style="background:none;border:none;cursor:pointer;color:var(--muted-foreground);padding:4px;display:inline-flex;align-items:center;" title="Copy URL"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button></span></div>' : '') +
        '<div class="task-detail-row"><span class="task-detail-label">Created:</span><span class="task-detail-value">' + createdAt + '</span></div>' +
        '<div class="task-detail-row"><span class="task-detail-label">Updated:</span><span class="task-detail-value">' + updatedAt + '</span></div>' +
        (t.blockedReason ? '<div class="task-detail-row"><span class="task-detail-label">Blocked:</span><span class="task-detail-value" style="color:#ef4444;">' + escapeHtml(t.blockedReason) + '</span></div>' : '') +
        '<div style="margin-top:8px;"><span class="task-detail-label" style="display:block;margin-bottom:4px;">Description:</span><textarea id="edit-detail-' + t.id + '" style="width:100%;min-height:80px;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--background);color:var(--foreground);font-size:0.875rem;resize:vertical;">' + (t.detail ? escapeHtml(t.detail) : '') + '</textarea></div>' +
        '<div class="task-detail-actions" style="margin-top:12px;">' +
          '<button class="action-btn primary" onclick="saveTask(\'' + t.id + '\')">Save Changes</button>' +
          claimBtn + readyBtn + startBtn + reviewBtn + holdBtn + completeBtn +
        '</div>' +
      '</div>' +
      '<div class="task-actions">' + 
        '<button class="action-btn" onclick="event.stopPropagation();moveTask(\'' + t.id + '\', \'up\')" title="Move up">↑</button>' +
        '<button class="action-btn" onclick="event.stopPropagation();moveTask(\'' + t.id + '\', \'down\')" title="Move down">↓</button>' +
        claimBtn + readyBtn + startBtn + reviewBtn + holdBtn + completeBtn + 
      '</div>' +
    '</div>' +
  '</div>';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function handleSwarmUIStream(request: Request): Response {
  // For now, just a placeholder - can add real-time updates later
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(': connected\n\n'));
      
      const pingInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          clearInterval(pingInterval);
        }
      }, 30000);
    },
  });
  
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

// Keyed Recurring Templates UI
async function handleRecurringUIWithKey(key: string): Promise<Response> {
  const config = uiMailboxKeys[key];
  if (!config) {
    return error("Invalid key", 404);
  }
  
  const identity = config.sender;
  const templates = await swarm.listTemplates({});
  const projects = await swarm.listProjects({ includeArchived: false });
  
  const keyPath = '/' + key;
  
  const formatSchedule = (t: swarm.RecurringTemplate): string => {
    let s = 'Every ' + t.everyInterval + ' ' + t.everyUnit + (t.everyInterval > 1 ? 's' : '');
    if (t.daysOfWeek && t.daysOfWeek.length > 0) {
      s += ' on ' + t.daysOfWeek.join(', ');
    }
    if (t.weekParity !== 'any') {
      s += ' (' + t.weekParity + ' weeks)';
    }
    return s;
  };
  
  const projectOptions = '<option value="">No Project</option>' + 
    projects.map(p => '<option value="' + p.id + '">' + escapeHtml(p.title) + '</option>').join('');
  
  const templateCards = templates.length === 0 
    ? '<div class="empty-state"><h3>No recurring templates</h3><p>Create your first recurring task template</p></div>'
    : templates.map(t => 
        '<div class="template-card" onclick="openDrawer(\'' + t.id + '\')">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
            '<div>' +
              '<div class="template-title">' + escapeHtml(t.title) + '</div>' +
              '<div class="template-schedule">' + formatSchedule(t) + '</div>' +
            '</div>' +
            '<span class="badge ' + (t.enabled ? 'badge-enabled' : 'badge-disabled') + '">' + (t.enabled ? 'Enabled' : 'Disabled') + '</span>' +
          '</div>' +
          '<div class="template-meta">' +
            '<span>Starts: ' + new Date(t.startAt).toLocaleDateString() + '</span>' +
            (t.endAt ? '<span>Ends: ' + new Date(t.endAt).toLocaleDateString() + '</span>' : '') +
            '<span>Owner: ' + t.ownerUserId + '</span>' +
          '</div>' +
        '</div>'
      ).join('');
  
  const html = '<!DOCTYPE html>' +
    '<html lang="en"><head>' +
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>Recurring Templates - Swarm</title>' +
    '<style>' +
    ':root { --background: #0a0a0a; --foreground: #fafafa; --card: #18181b; --border: #27272a; --muted-foreground: #a1a1aa; --primary: #0ea5e9; --secondary: #27272a; --radius: 6px; }' +
    'body.light { --background: #ffffff; --foreground: #0a0a0a; --card: #f4f4f5; --border: #e4e4e7; --muted-foreground: #71717a; --secondary: #f4f4f5; }' +
    '* { box-sizing: border-box; margin: 0; padding: 0; }' +
    'body { font-family: system-ui, sans-serif; background: var(--background); color: var(--foreground); min-height: 100vh; }' +
    '.container { max-width: 1000px; margin: 0 auto; padding: 24px; }' +
    '.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }' +
    '.header h1 { font-size: 1.5rem; }' +
    '.nav { display: flex; gap: 8px; }' +
    '.nav a { color: var(--muted-foreground); text-decoration: none; padding: 6px 12px; border-radius: var(--radius); font-size: 0.875rem; }' +
    '.nav a:hover { background: var(--secondary); color: var(--foreground); }' +
    '.nav a.active { background: var(--primary); color: white; }' +
    '.template-list { display: flex; flex-direction: column; gap: 12px; }' +
    '.template-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; cursor: pointer; }' +
    '.template-card:hover { border-color: var(--primary); }' +
    '.template-title { font-weight: 600; margin-bottom: 4px; }' +
    '.template-schedule { font-size: 0.875rem; color: var(--muted-foreground); }' +
    '.template-meta { display: flex; gap: 12px; margin-top: 8px; font-size: 0.75rem; color: var(--muted-foreground); }' +
    '.badge { padding: 2px 8px; border-radius: 999px; font-size: 0.7rem; }' +
    '.badge-enabled { background: rgba(34, 197, 94, 0.1); color: #22c55e; }' +
    '.badge-disabled { background: rgba(239, 68, 68, 0.1); color: #ef4444; }' +
    '.btn { padding: 8px 16px; border-radius: var(--radius); cursor: pointer; font-size: 0.875rem; border: 1px solid var(--border); background: var(--background); color: var(--foreground); }' +
    '.btn:hover { background: var(--secondary); }' +
    '.btn-primary { background: var(--primary); color: white; border-color: var(--primary); }' +
    '.empty-state { text-align: center; padding: 60px 20px; color: var(--muted-foreground); }' +
    '.drawer-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1000; }' +
    '.drawer-overlay.open { display: block; }' +
    '.drawer { position: fixed; top: 0; right: -450px; width: 450px; max-width: 95vw; height: 100vh; background: var(--card); border-left: 1px solid var(--border); z-index: 1001; transition: right 0.2s; display: flex; flex-direction: column; }' +
    '.drawer.open { right: 0; }' +
    '.drawer-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--border); }' +
    '.drawer-body { flex: 1; padding: 20px; overflow-y: auto; }' +
    '.drawer-body label { display: block; font-size: 0.75rem; color: var(--muted-foreground); margin-bottom: 4px; text-transform: uppercase; }' +
    '.drawer-body input, .drawer-body select, .drawer-body textarea { width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--background); color: var(--foreground); font-size: 0.875rem; margin-bottom: 16px; }' +
    '.drawer-footer { padding: 16px 20px; border-top: 1px solid var(--border); display: flex; gap: 12px; }' +
    '.drawer-footer button { flex: 1; }' +
    '.form-row { display: flex; gap: 12px; }' +
    '.form-row > * { flex: 1; }' +
    '</style></head><body>' +
    '<div class="container">' +
      '<div class="header">' +
        '<h1>🔄 Recurring Templates</h1>' +
        '<nav class="nav">' +
          '<a href="/ui' + keyPath + '">Messages</a>' +
          '<a href="/ui' + keyPath + '/buzz">Buzz</a>' +
          '<a href="/ui' + keyPath + '/swarm">Tasks</a>' +
          '<a href="/ui' + keyPath + '/swarm/recurring" class="active">Recurring</a>' +
        '</nav>' +
      '</div>' +
      '<button class="btn btn-primary" onclick="openDrawer()" style="margin-bottom:16px;">+ New Template</button>' +
      '<div class="template-list">' + templateCards + '</div>' +
    '</div>' +
    '<div class="drawer-overlay" id="drawerOverlay" onclick="closeDrawer()"></div>' +
    '<div class="drawer" id="drawer">' +
      '<div class="drawer-header"><h2 id="drawerTitle">New Template</h2><button onclick="closeDrawer()" style="background:none;border:none;cursor:pointer;color:var(--muted-foreground);font-size:1.25rem;">×</button></div>' +
      '<div class="drawer-body">' +
        '<input type="hidden" id="templateId">' +
        '<label>Title *</label><input type="text" id="templateTitle" placeholder="Template title...">' +
        '<label>Project</label><select id="templateProject">' + projectOptions + '</select>' +
        '<label>Description</label><textarea id="templateDetail" placeholder="Details..." style="min-height:60px;resize:vertical;"></textarea>' +
        '<div class="form-row"><div><label>Every *</label><input type="number" id="everyInterval" value="1" min="1"></div><div><label>Unit *</label><select id="everyUnit"><option value="minute">Minutes</option><option value="hour">Hours</option><option value="day" selected>Days</option><option value="week">Weeks</option><option value="month">Months</option></select></div></div>' +
        '<label>Start Date *</label><input type="datetime-local" id="startAt">' +
        '<label>End Date (optional)</label><input type="datetime-local" id="endAt">' +
        '<label>Days of Week (optional)</label><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;"><label style="display:flex;gap:4px;font-size:0.8rem;"><input type="checkbox" value="mon" class="dow"> Mon</label><label style="display:flex;gap:4px;font-size:0.8rem;"><input type="checkbox" value="tue" class="dow"> Tue</label><label style="display:flex;gap:4px;font-size:0.8rem;"><input type="checkbox" value="wed" class="dow"> Wed</label><label style="display:flex;gap:4px;font-size:0.8rem;"><input type="checkbox" value="thu" class="dow"> Thu</label><label style="display:flex;gap:4px;font-size:0.8rem;"><input type="checkbox" value="fri" class="dow"> Fri</label><label style="display:flex;gap:4px;font-size:0.8rem;"><input type="checkbox" value="sat" class="dow"> Sat</label><label style="display:flex;gap:4px;font-size:0.8rem;"><input type="checkbox" value="sun" class="dow"> Sun</label></div>' +
        '<label>Week Parity</label><select id="weekParity"><option value="any">Any week</option><option value="odd">Odd weeks only</option><option value="even">Even weeks only</option></select>' +
        '<label>Between Hours (optional)</label><div class="form-row"><div><input type="number" id="betweenStart" min="0" max="23" placeholder="Start (0-23)"></div><div><input type="number" id="betweenEnd" min="0" max="23" placeholder="End (0-23)"></div></div>' +
        '<label>Timezone</label><select id="timezone"><option value="America/Chicago" selected>America/Chicago</option><option value="America/New_York">America/New_York</option><option value="America/Los_Angeles">America/Los_Angeles</option><option value="UTC">UTC</option></select>' +
        '<label>Primary Agent</label><select id="primaryAgent"><option value="">None</option><option value="chris">Chris</option><option value="clio">Clio</option><option value="domingo">Domingo</option><option value="zumie">Zumie</option></select>' +
        '<label>Fallback Agent</label><select id="fallbackAgent"><option value="">None</option><option value="chris">Chris</option><option value="clio">Clio</option><option value="domingo">Domingo</option><option value="zumie">Zumie</option></select>' +
        '<label style="display:flex;align-items:center;gap:8px;margin-top:8px;"><input type="checkbox" id="mute"> Mute notifications</label>' +
        '<div id="muteIntervalRow" style="display:none;margin-top:8px;"><label>Mute Interval</label><input type="text" id="muteInterval" placeholder="e.g. 1 hour, 30 minutes"></div>' +
      '</div>' +
      '<div class="drawer-footer"><button class="btn" onclick="closeDrawer()">Cancel</button><button class="btn btn-primary" onclick="saveTemplate()">Save</button></div>' +
    '</div>' +
    '<script>' +
      'const UI_KEY = "' + key + '";' +
      'const TEMPLATES = ' + JSON.stringify(templates) + ';' +
      'function openDrawer(id) {' +
        'document.getElementById("drawerOverlay").classList.add("open");' +
        'document.getElementById("drawer").classList.add("open");' +
        'if (id) {' +
          'const t = TEMPLATES.find(x => x.id === id);' +
          'if (!t) return;' +
          'document.getElementById("drawerTitle").textContent = "Edit Template";' +
          'document.getElementById("templateId").value = t.id;' +
          'document.getElementById("templateTitle").value = t.title;' +
          'document.getElementById("templateProject").value = t.projectId || "";' +
          'document.getElementById("templateDetail").value = t.detail || "";' +
          'document.getElementById("everyInterval").value = t.everyInterval;' +
          'document.getElementById("everyUnit").value = t.everyUnit;' +
          'document.getElementById("startAt").value = t.startAt ? new Date(t.startAt).toISOString().slice(0,16) : "";' +
          'document.getElementById("endAt").value = t.endAt ? new Date(t.endAt).toISOString().slice(0,16) : "";' +
          'document.getElementById("weekParity").value = t.weekParity;' +
          'document.getElementById("betweenStart").value = t.betweenHoursStart ?? "";' +
          'document.getElementById("betweenEnd").value = t.betweenHoursEnd ?? "";' +
          'document.getElementById("timezone").value = t.timezone || "America/Chicago";' +
          'document.getElementById("primaryAgent").value = t.primaryAgent || "";' +
          'document.getElementById("fallbackAgent").value = t.fallbackAgent || "";' +
          'document.getElementById("mute").checked = t.mute || false;' +
          'document.getElementById("muteInterval").value = t.muteInterval || "";' +
          'document.getElementById("muteIntervalRow").style.display = t.mute ? "block" : "none";' +
          'document.querySelectorAll(".dow").forEach(cb => { cb.checked = t.daysOfWeek && t.daysOfWeek.includes(cb.value); });' +
        '} else {' +
          'document.getElementById("drawerTitle").textContent = "New Template";' +
          'document.getElementById("templateId").value = "";' +
          'document.getElementById("templateTitle").value = "";' +
          'document.getElementById("templateProject").value = "";' +
          'document.getElementById("templateDetail").value = "";' +
          'document.getElementById("everyInterval").value = "1";' +
          'document.getElementById("everyUnit").value = "day";' +
          'document.getElementById("startAt").value = "";' +
          'document.getElementById("endAt").value = "";' +
          'document.getElementById("weekParity").value = "any";' +
          'document.getElementById("betweenStart").value = "";' +
          'document.getElementById("betweenEnd").value = "";' +
          'document.getElementById("timezone").value = "America/Chicago";' +
          'document.getElementById("primaryAgent").value = "";' +
          'document.getElementById("fallbackAgent").value = "";' +
          'document.getElementById("mute").checked = false;' +
          'document.getElementById("muteInterval").value = "";' +
          'document.getElementById("muteIntervalRow").style.display = "none";' +
          'document.querySelectorAll(".dow").forEach(cb => cb.checked = false);' +
        '}' +
      '}' +
      'function closeDrawer() {' +
        'document.getElementById("drawerOverlay").classList.remove("open");' +
        'document.getElementById("drawer").classList.remove("open");' +
      '}' +
      'document.getElementById("mute").onchange = function() { document.getElementById("muteIntervalRow").style.display = this.checked ? "block" : "none"; };' +
      'async function saveTemplate() {' +
        'const id = document.getElementById("templateId").value;' +
        'const title = document.getElementById("templateTitle").value.trim();' +
        'const projectId = document.getElementById("templateProject").value || null;' +
        'const detail = document.getElementById("templateDetail").value.trim() || null;' +
        'const everyInterval = parseInt(document.getElementById("everyInterval").value);' +
        'const everyUnit = document.getElementById("everyUnit").value;' +
        'const startAt = document.getElementById("startAt").value;' +
        'const endAt = document.getElementById("endAt").value || null;' +
        'const weekParity = document.getElementById("weekParity").value;' +
        'const betweenStart = document.getElementById("betweenStart").value;' +
        'const betweenEnd = document.getElementById("betweenEnd").value;' +
        'const timezone = document.getElementById("timezone").value;' +
        'const primaryAgent = document.getElementById("primaryAgent").value || null;' +
        'const fallbackAgent = document.getElementById("fallbackAgent").value || null;' +
        'const mute = document.getElementById("mute").checked;' +
        'const muteInterval = document.getElementById("muteInterval").value || null;' +
        'const daysOfWeek = [...document.querySelectorAll(".dow:checked")].map(cb => cb.value);' +
        'if (!title) return alert("Title is required");' +
        'if (!startAt) return alert("Start date is required");' +
        'if (!everyInterval || everyInterval < 1) return alert("Interval must be at least 1");' +
        'const body = { title, projectId, detail, everyInterval, everyUnit, startAt: new Date(startAt).toISOString(), endAt: endAt ? new Date(endAt).toISOString() : null, weekParity, betweenHoursStart: betweenStart ? parseInt(betweenStart) : null, betweenHoursEnd: betweenEnd ? parseInt(betweenEnd) : null, timezone, primaryAgent, fallbackAgent, mute, muteInterval, daysOfWeek: daysOfWeek.length > 0 ? daysOfWeek : null };' +
        'const url = id ? "/api/swarm/recurring/templates/" + id : "/api/swarm/recurring/templates";' +
        'const method = id ? "PATCH" : "POST";' +
        'const res = await fetch(url, { method, headers: { "Content-Type": "application/json", "Authorization": "Bearer " + UI_KEY }, body: JSON.stringify(body) });' +
        'if (res.ok) { location.reload(); } else { const err = await res.json(); alert("Error: " + (err.error || "Failed to save")); }' +
      '}' +
      'const savedTheme = localStorage.getItem("theme"); if (savedTheme === "light") document.body.classList.add("light");' +
    '</script>' +
    '</body></html>';
  
  return new Response(html, { headers: { "Content-Type": "text/html" } });
}

// Keyed Swarm UI - validates key and renders with auth context
async function handleSwarmUIWithKey(key: string): Promise<Response> {
  const config = uiMailboxKeys[key];
  if (!config) {
    return error("Invalid key", 404);
  }
  
  const identity = config.sender;
  const projects = await swarm.listProjects({ includeArchived: false });
  const tasks = await swarm.listTasks({ 
    includeCompleted: false,
    includeFuture: true,
    sort: 'planned',
    limit: 100
  });
  const enrichedTasks = await swarm.enrichTasksWithBlocked(tasks);
  
  // Build the same UI but with auth headers for API calls
  const html = renderSwarmHTML(projects, enrichedTasks, key, identity);
  return new Response(html, { headers: { "Content-Type": "text/html" } });
}

// Keyed Buzz UI - validates key and renders Buzz with auth context
async function handleBroadcastUIWithKey(key: string): Promise<Response> {
  const config = uiMailboxKeys[key];
  if (!config) {
    return error("Invalid key", 404);
  }
  
  // For now, render the existing Buzz UI (public view is fine for Buzz as it's broadcast)
  // TODO: Could add key-aware filtering here if needed
  return handleBroadcastUI();
}

// Shared HTML renderer for Swarm UI
function renderSwarmHTML(projects: swarm.SwarmProject[], tasks: swarm.SwarmTask[], key: string | null, identity: string | null): string {
  const keyPath = key ? '/' + key : '';
  const authHeader = key ? ', headers: { "Authorization": "Bearer " + getToken() }' : '';
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hive - Swarm</title>
  <style>
    :root {
      --background: #0a0a0a;
      --foreground: #fafafa;
      --card: #18181b;
      --card-foreground: #fafafa;
      --primary: #0ea5e9;
      --primary-foreground: #f0f9ff;
      --secondary: #27272a;
      --secondary-foreground: #fafafa;
      --muted: #27272a;
      --muted-foreground: #a1a1aa;
      --accent: #0ea5e9;
      --accent-foreground: #f0f9ff;
      --border: #27272a;
      --input: #27272a;
      --radius: 8px;
    }
    body.light {
      --background: #fafafa;
      --foreground: #18181b;
      --card: #ffffff;
      --card-foreground: #18181b;
      --primary: #0ea5e9;
      --primary-foreground: #f0f9ff;
      --secondary: #f4f4f5;
      --secondary-foreground: #18181b;
      --muted: #f4f4f5;
      --muted-foreground: #71717a;
      --accent: #0ea5e9;
      --accent-foreground: #f0f9ff;
      --border: #e4e4e7;
      --input: #e4e4e7;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { 
      font-family: system-ui, -apple-system, sans-serif; 
      background: var(--background); 
      color: var(--foreground);
      min-height: 100vh;
      max-width: 100vw;
      overflow-x: hidden;
    }
    .layout { display: flex; min-height: 100vh; max-width: 100vw; }
    .sidebar { 
      width: 240px; 
      border-right: 1px solid var(--border); 
      padding: 20px;
      flex-shrink: 0;
      background: var(--background);
      transition: transform 0.25s ease;
      overflow-y: auto;
    }
    .sidebar-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 40;
    }
    .hamburger {
      display: none;
      width: 36px; height: 36px;
      background: var(--secondary);
      border: none;
      border-radius: var(--radius);
      cursor: pointer;
      color: var(--foreground);
      align-items: center;
      justify-content: center;
      margin-right: 8px;
    }
    @media (max-width: 768px) {
      .sidebar {
        position: fixed;
        left: 0;
        top: 0;
        bottom: 0;
        z-index: 50;
        transform: translateX(-100%);
      }
      .sidebar.open { transform: translateX(0); }
      .sidebar-overlay.open { display: block; }
      .hamburger { display: inline-flex; }
      .content { padding: 16px; }
      .header { padding: 12px 16px; }
      .nav a { padding: 4px 8px; font-size: 0.8rem; }
    }
    .main { flex: 1; display: flex; flex-direction: column; }
    .header { 
      display: flex; 
      justify-content: space-between; 
      align-items: center; 
      padding: 16px 24px;
      border-bottom: 1px solid var(--border);
    }
    .header h1 { font-size: 1.25rem; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    .nav { display: flex; gap: 8px; align-items: center; }
    .nav a { 
      color: var(--muted-foreground); 
      text-decoration: none; 
      padding: 6px 12px;
      border-radius: var(--radius);
      font-size: 0.875rem;
      height: 36px;
      display: inline-flex;
      align-items: center;
    }
    .nav a:hover { background: var(--secondary); color: var(--foreground); }
    .nav a.active { background: var(--primary); color: var(--primary-foreground); }
    .nav .icon-btn { 
      width: 36px; height: 36px; 
      display: inline-flex; align-items: center; justify-content: center; 
      padding: 0; line-height: 0; 
      background: transparent; border: none; 
      cursor: pointer; color: var(--foreground); opacity: 0.7; 
    }
    .nav .icon-btn:hover { opacity: 1; }
    .nav .icon-btn svg, .theme-toggle svg { width: 18px; height: 18px; display: block; }
    .theme-toggle {
      width: 36px; height: 36px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--secondary); border: none; border-radius: var(--radius);
      cursor: pointer; color: var(--foreground);
    }
    .content { flex: 1; padding: 24px; overflow-y: auto; max-width: 100%; }
    .user-badge { font-size: 0.75rem; background: var(--primary); color: white; padding: 2px 8px; border-radius: 999px; margin-left: 8px; }
    
    /* Filter sidebar */
    .filter-section { margin-bottom: 24px; }
    .filter-header { 
      display: flex; 
      justify-content: space-between; 
      align-items: center; 
      margin-bottom: 8px;
    }
    .filter-section h3 { 
      font-size: 0.75rem; 
      text-transform: uppercase; 
      color: var(--muted-foreground); 
      letter-spacing: 0.05em;
      margin: 0;
    }
    .filter-toggles { display: flex; gap: 4px; }
    .filter-toggles button {
      font-size: 0.625rem;
      padding: 2px 6px;
      background: transparent;
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--muted-foreground);
      cursor: pointer;
    }
    .filter-toggles button:hover { background: var(--secondary); color: var(--foreground); }
    .filter-option { 
      display: flex; 
      align-items: center; 
      gap: 8px; 
      padding: 6px 8px;
      border-radius: var(--radius);
      cursor: pointer;
      font-size: 0.875rem;
    }
    .filter-option:hover { background: var(--secondary); }
    .filter-option input { cursor: pointer; accent-color: var(--primary); }
    .filter-option.checked { background: var(--secondary); }
    
    /* Task list */
    .task-list { display: flex; flex-direction: column; gap: 8px; }
    .task-card { 
      background: var(--card); 
      border: 1px solid var(--border); 
      border-radius: var(--radius);
      padding: 16px;
      display: flex;
      gap: 12px;
      cursor: pointer;
      transition: border-color 0.15s;
    }
    .task-card:hover { border-color: var(--primary); }
    .task-card.selected { border-color: var(--primary); background: rgba(14, 165, 233, 0.05); }
    .task-accent { width: 4px; border-radius: 2px; flex-shrink: 0; }
    .task-content { flex: 1; min-width: 0; overflow: hidden; }
    .task-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; flex-wrap: wrap; }
    .task-title { font-weight: 500; margin-bottom: 4px; word-break: break-word; }
    .task-meta { font-size: 0.8125rem; color: var(--muted-foreground); display: flex; gap: 8px; flex-wrap: wrap; }
    .task-badges { display: flex; gap: 6px; flex-shrink: 0; flex-wrap: wrap; }
    .badge { 
      font-size: 0.6875rem; 
      padding: 2px 8px; 
      border-radius: 999px; 
      font-weight: 500;
      text-transform: uppercase;
    }
    .badge-queued { background: var(--secondary); color: var(--muted-foreground); }
    .badge-ready { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
    .badge-in_progress { background: rgba(14, 165, 233, 0.15); color: #0ea5e9; }
    .badge-holding { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
    .badge-review { background: rgba(168, 85, 247, 0.15); color: #a855f7; }
    .badge-complete { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
    .badge-blocked { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
    
    /* Quick actions */
    .task-actions { display: none; gap: 4px; margin-top: 8px; flex-wrap: wrap; }
    .task-card:hover .task-actions { display: flex; }
    .task-card.expanded .task-actions { display: none; }  /* Hide hover actions when expanded - detail section has them */
    
    /* Expanded task detail */
    .task-card.expanded { border-color: var(--primary); }
    .task-detail { display: none; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
    .task-card.expanded .task-detail { display: block; }
    .task-detail-row { display: flex; gap: 8px; margin-bottom: 8px; font-size: 0.8125rem; }
    .task-detail-label { color: var(--muted-foreground); min-width: 80px; }
    .task-detail-value { color: var(--foreground); }
    .task-detail-body { white-space: pre-wrap; line-height: 1.5; color: var(--foreground); margin-top: 8px; padding: 12px; background: var(--secondary); border-radius: var(--radius); }
    .task-detail-actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    .action-btn { 
      font-size: 0.75rem; 
      padding: 4px 8px; 
      border-radius: var(--radius);
      border: 1px solid var(--border);
      background: var(--background);
      color: var(--foreground);
      cursor: pointer;
    }
    .action-btn:hover { background: var(--secondary); }
    .action-btn.primary { background: var(--primary); color: white; border-color: var(--primary); }
    .preset-btn {
      font-size: 0.8rem;
      padding: 8px 12px;
      border-radius: var(--radius);
      border: 1px solid var(--border);
      background: var(--secondary);
      color: var(--foreground);
      cursor: pointer;
      text-align: left;
    }
    .preset-btn:hover { background: var(--primary); color: white; border-color: var(--primary); }
    
    /* Empty state */
    .empty-state { text-align: center; padding: 60px 20px; color: var(--muted-foreground); }
    .empty-state h3 { font-size: 1rem; margin-bottom: 8px; color: var(--foreground); }
    
    /* Create task form */
    .create-form { 
      background: var(--card); 
      border: 1px solid var(--border); 
      border-radius: var(--radius);
      padding: 16px;
      margin-bottom: 16px;
    }
    .create-form input, .create-form select, .create-form textarea { 
      width: 100%;
      padding: 8px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--background);
      color: var(--foreground);
      font-size: 0.875rem;
      margin-bottom: 12px;
    }
    .create-form textarea { min-height: 80px; resize: vertical; }
    .form-row { display: flex; gap: 12px; }
    .form-row > * { flex: 1; }
    .create-btn { 
      background: var(--primary); 
      color: white; 
      border: none; 
      padding: 8px 16px;
      border-radius: var(--radius);
      cursor: pointer;
      font-size: 0.875rem;
      font-weight: 500;
    }
    .create-btn:hover { opacity: 0.9; }
    
    body.light .badge-queued { background: #f4f4f5; color: #71717a; }
    body.light .badge-ready { background: rgba(34, 197, 94, 0.1); color: #16a34a; }
    body.light .badge-in_progress { background: rgba(14, 165, 233, 0.1); color: #0284c7; }
    body.light .badge-holding { background: rgba(245, 158, 11, 0.1); color: #d97706; }
    body.light .badge-review { background: rgba(168, 85, 247, 0.1); color: #9333ea; }
    body.light .badge-blocked { background: rgba(239, 68, 68, 0.1); color: #dc2626; }
    
    /* Project edit drawer */
    .project-drawer-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 1000;
    }
    .project-drawer-overlay.open { display: block; }
    .project-drawer {
      position: fixed;
      top: 0;
      right: -400px;
      width: 400px;
      max-width: 90vw;
      height: 100vh;
      background: var(--card);
      border-left: 1px solid var(--border);
      z-index: 1001;
      transition: right 0.2s ease;
      display: flex;
      flex-direction: column;
    }
    .project-drawer.open { right: 0; }
    .project-drawer-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
    }
    .project-drawer-header h2 { font-size: 1.125rem; font-weight: 600; margin: 0; }
    .project-drawer-body { flex: 1; padding: 20px; overflow-y: auto; }
    .project-drawer-body label { display: block; font-size: 0.75rem; color: var(--muted-foreground); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
    .project-drawer-body input, .project-drawer-body textarea, .project-drawer-body select {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--background);
      color: var(--foreground);
      font-size: 0.875rem;
      margin-bottom: 16px;
    }
    .project-drawer-body textarea { min-height: 80px; resize: vertical; }
    .project-drawer-footer { padding: 16px 20px; border-top: 1px solid var(--border); display: flex; gap: 12px; }
    .project-drawer-footer button { flex: 1; padding: 10px; border-radius: var(--radius); cursor: pointer; font-size: 0.875rem; }
    .project-drawer-footer .save-btn { background: var(--primary); color: white; border: none; }
    .project-drawer-footer .cancel-btn { background: transparent; border: 1px solid var(--border); color: var(--foreground); }
    .project-name-btn { background: none; border: none; cursor: pointer; color: var(--foreground); text-align: left; padding: 0; font-size: inherit; }
    .project-name-btn:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="sidebar-overlay" id="sidebarOverlay" onclick="toggleSidebar()"></div>
  <div class="layout">
    <aside class="sidebar" id="sidebar">
      <div class="filter-section" style="border-bottom:1px solid var(--border);padding-bottom:16px;margin-bottom:16px;">
        <h3>Quick Views</h3>
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;">
          <button class="preset-btn" onclick="applyPreset('my-tasks')">My Tasks</button>
          <button class="preset-btn" onclick="applyPreset('ready-next')">Ready Next</button>
          <button class="preset-btn" onclick="applyPreset('unassigned')">Unassigned</button>
          <button class="preset-btn" onclick="applyPreset('all')">Show All</button>
        </div>
      </div>
      <div class="filter-section">
        <div class="filter-header">
          <h3>Status</h3>
          <div class="filter-toggles">
            <button onclick="toggleAllFilters('status', true)">All</button>
            <button onclick="toggleAllFilters('status', false)">None</button>
          </div>
        </div>
        <label class="filter-option checked"><input type="checkbox" checked data-filter="status" value="queued"> Queued</label>
        <label class="filter-option checked"><input type="checkbox" checked data-filter="status" value="ready"> Ready</label>
        <label class="filter-option checked"><input type="checkbox" checked data-filter="status" value="in_progress"> In Progress</label>
        <label class="filter-option checked"><input type="checkbox" checked data-filter="status" value="holding"> Holding</label>
        <label class="filter-option checked"><input type="checkbox" checked data-filter="status" value="review"> Review</label>
        <label class="filter-option"><input type="checkbox" data-filter="status" value="complete"> Complete</label>
      </div>
      <div class="filter-section">
        <div class="filter-header">
          <h3>Assignee</h3>
          <div class="filter-toggles">
            <button onclick="toggleAllFilters('assignee', true)">All</button>
            <button onclick="toggleAllFilters('assignee', false)">None</button>
          </div>
        </div>
        <label class="filter-option checked"><input type="checkbox" checked data-filter="assignee" value="unassigned"> Unassigned</label>
        <label class="filter-option checked"><input type="checkbox" checked data-filter="assignee" value="chris"> Chris</label>
        <label class="filter-option checked"><input type="checkbox" checked data-filter="assignee" value="clio"> Clio</label>
        <label class="filter-option checked"><input type="checkbox" checked data-filter="assignee" value="domingo"> Domingo</label>
        <label class="filter-option checked"><input type="checkbox" checked data-filter="assignee" value="zumie"> Zumie</label>
      </div>
      <div class="filter-section">
        <div class="filter-header">
          <h3>Project</h3>
          <div class="filter-toggles">
            <button onclick="toggleAllFilters('project', true)">All</button>
            <button onclick="toggleAllFilters('project', false)">None</button>
          </div>
        </div>
        <label class="filter-option checked"><input type="checkbox" checked data-filter="project" value="none"> No Project</label>
        ${projects.map(p => `<label class="filter-option checked" style="display:flex;align-items:center;gap:4px;">
          <input type="checkbox" checked data-filter="project" value="${p.id}">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};flex-shrink:0;"></span>
          <button class="project-name-btn" onclick="event.preventDefault();event.stopPropagation();openProjectDrawer('${p.id}')">${escapeHtml(p.title)}</button>
        </label>`).join('')}
      </div>
      <div class="filter-section">
        <h3>Sort</h3>
        <select id="sortSelect" onchange="applyFilters()" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--background);color:var(--foreground);font-size:0.875rem;">
          <option value="planned">Planned (default)</option>
          <option value="createdAt-desc">Created (newest)</option>
          <option value="createdAt-asc">Created (oldest)</option>
          <option value="updatedAt-desc">Updated (newest)</option>
          <option value="updatedAt-asc">Updated (oldest)</option>
        </select>
      </div>
      <div class="filter-section">
        <h3>Options</h3>
        <label class="filter-option"><input type="checkbox" id="showFuture" onchange="applyFilters()"> Show future tasks</label>
      </div>
      <div class="filter-section" style="border-top:1px solid var(--border);padding-top:16px;margin-top:auto;">
        <button class="action-btn" onclick="toggleProjectForm()" style="width:100%;">+ New Project</button>
        <div id="projectForm" style="display:none;margin-top:12px;">
          <input type="text" id="newProjectTitle" placeholder="Project name..." style="width:100%;padding:8px;margin-bottom:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--background);color:var(--foreground);font-size:0.875rem;">
          <textarea id="newProjectDesc" placeholder="Description (optional)..." style="width:100%;padding:8px;margin-bottom:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--background);color:var(--foreground);font-size:0.875rem;min-height:60px;resize:vertical;"></textarea>
          <div style="display:flex;gap:8px;margin-bottom:8px;">
            <input type="color" id="newProjectColor" value="#3B82F6" style="width:40px;height:32px;padding:2px;border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;">
            <select id="newProjectLead" style="flex:1;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--background);color:var(--foreground);font-size:0.875rem;">
              <option value="">Project Lead</option>
              <option value="chris">Chris</option>
              <option value="clio">Clio</option>
              <option value="domingo">Domingo</option>
              <option value="zumie">Zumie</option>
            </select>
          </div>
          <select id="newProjectDevLead" style="width:100%;padding:8px;margin-bottom:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--background);color:var(--foreground);font-size:0.875rem;">
            <option value="">Dev Lead</option>
            <option value="chris">Chris</option>
            <option value="clio">Clio</option>
            <option value="domingo">Domingo</option>
            <option value="zumie">Zumie</option>
          </select>
          <input type="url" id="newProjectRepoUrl" placeholder="Repo URL (OneDev)..." style="width:100%;padding:8px;margin-bottom:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--background);color:var(--foreground);font-size:0.875rem;">
          <input type="url" id="newProjectDeployUrl" placeholder="Deploy URL (Dokploy)..." style="width:100%;padding:8px;margin-bottom:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--background);color:var(--foreground);font-size:0.875rem;">
          <button class="create-btn" onclick="createProject()" style="width:100%;">Create Project</button>
        </div>
      </div>
    </aside>
    <main class="main">
      <header class="header">
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="hamburger" onclick="toggleSidebar()" title="Toggle filters">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <h1 style="margin:0;">${ICONS.swarm} Swarm${identity ? '<span class="user-badge">' + identity + '</span>' : ''}</h1>
        </div>
        <nav class="nav">
          <a href="/ui${keyPath}">Messages</a>
          <a href="/ui${keyPath}/buzz">Buzz</a>
          <a href="/ui${keyPath}/swarm" class="active">Tasks</a>
          <a href="/ui${keyPath}/swarm/recurring">Recurring</a>
          ${key ? '<button onclick="logout()" style="color:var(--muted-foreground);padding:6px 12px;border-radius:var(--radius);font-size:0.875rem;background:transparent;border:1px solid var(--border);cursor:pointer;">Logout</button>' : ''}
          <button class="theme-toggle" onclick="toggleTheme()" title="Toggle theme">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
          </button>
        </nav>
      </header>
      <div class="content">
        <div class="create-form" id="createForm" style="display:none;">
          <input type="text" id="newTaskTitle" placeholder="Task title..." />
          <div class="form-row">
            <select id="newTaskProject">
              <option value="">No project</option>
              ${projects.map(p => '<option value="' + p.id + '">' + p.title + '</option>').join('')}
            </select>
            <select id="newTaskAssignee">
              <option value="">Unassigned</option>
              <option value="chris">Chris</option>
              <option value="clio">Clio</option>
              <option value="domingo">Domingo</option>
              <option value="zumie">Zumie</option>
            </select>
          </div>
          <textarea id="newTaskDetail" placeholder="Details (optional)..."></textarea>
          <input type="url" id="newTaskIssueUrl" placeholder="Issue URL (GitHub, OneDev, etc.)..." style="margin-top:8px;">
          <div class="form-row" style="margin-top:8px;">
            <label style="display:flex;align-items:center;gap:8px;font-size:0.8rem;color:var(--muted-foreground);">
              <span>Start after:</span>
              <input type="datetime-local" id="newTaskOnOrAfter" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--background);color:var(--foreground);font-size:0.8rem;">
            </label>
          </div>
          <button class="create-btn" onclick="createTask()">Create Task</button>
        </div>
        <button class="action-btn" onclick="toggleCreateForm()" style="margin-bottom:16px;">+ New Task</button>
        <div class="task-list" id="taskList">
          ${tasks.length === 0 ? '<div class="empty-state"><h3>No tasks yet</h3><p>Create your first task to get started</p></div>' : 
            tasks.map(t => renderTaskCard(t, projects, tasks)).join('')}
        </div>
      </div>
    </main>
  </div>
  
  <!-- Project Edit Drawer -->
  <div class="project-drawer-overlay" id="projectDrawerOverlay" onclick="closeProjectDrawer()"></div>
  <div class="project-drawer" id="projectDrawer">
    <div class="project-drawer-header">
      <h2>Edit Project</h2>
      <button onclick="closeProjectDrawer()" style="background:none;border:none;cursor:pointer;color:var(--muted-foreground);font-size:1.25rem;">&times;</button>
    </div>
    <div class="project-drawer-body">
      <input type="hidden" id="editProjectId">
      <label>Title</label>
      <input type="text" id="editProjectTitle" placeholder="Project name...">
      <label>Description</label>
      <textarea id="editProjectDesc" placeholder="Project description..."></textarea>
      <label>Color</label>
      <input type="color" id="editProjectColor" style="width:60px;height:40px;padding:4px;">
      <label>Project Lead</label>
      <select id="editProjectLead">
        <option value="">No lead</option>
        <option value="chris">Chris</option>
        <option value="clio">Clio</option>
        <option value="domingo">Domingo</option>
        <option value="zumie">Zumie</option>
      </select>
      <label>Dev Lead</label>
      <select id="editProjectDevLead">
        <option value="">No lead</option>
        <option value="chris">Chris</option>
        <option value="clio">Clio</option>
        <option value="domingo">Domingo</option>
        <option value="zumie">Zumie</option>
      </select>
      <label>Repo URL (OneDev)</label>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:16px;">
        <input type="url" id="editProjectRepo" placeholder="https://dev.biginformatics.net/..." style="flex:1;margin-bottom:0;">
        <button onclick="const v=document.getElementById('editProjectRepo').value;if(v)copyUrl(v,this)" style="background:none;border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;color:var(--muted-foreground);padding:8px;display:inline-flex;align-items:center;" title="Copy URL"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
        <a id="editProjectRepoLink" href="#" target="_blank" rel="noopener" style="display:none;background:none;border:1px solid var(--border);border-radius:var(--radius);color:var(--muted-foreground);padding:8px;text-decoration:none;" title="Open URL"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>
      </div>
      <label>Deploy URL (Dokploy)</label>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:16px;">
        <input type="url" id="editProjectDeploy" placeholder="https://cp.biginformatics.net/..." style="flex:1;margin-bottom:0;">
        <button onclick="const v=document.getElementById('editProjectDeploy').value;if(v)copyUrl(v,this)" style="background:none;border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;color:var(--muted-foreground);padding:8px;display:inline-flex;align-items:center;" title="Copy URL"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
        <a id="editProjectDeployLink" href="#" target="_blank" rel="noopener" style="display:none;background:none;border:1px solid var(--border);border-radius:var(--radius);color:var(--muted-foreground);padding:8px;text-decoration:none;" title="Open URL"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>
      </div>
    </div>
    <div class="project-drawer-footer">
      <button class="cancel-btn" onclick="closeProjectDrawer()">Cancel</button>
      <button class="save-btn" onclick="saveProject()">Save</button>
    </div>
  </div>
  
  <script>
    const UI_KEY = ${key ? "'" + key + "'" : 'null'};
    function getToken() { return UI_KEY; }
    
    // Projects data for edit drawer
    const PROJECTS_DATA = ${JSON.stringify(projects.map(p => ({
      id: p.id,
      title: p.title,
      description: p.description || '',
      color: p.color,
      projectLeadUserId: p.projectLeadUserId || '',
      developerLeadUserId: p.developerLeadUserId || '',
      onedevUrl: p.onedevUrl || '',
      dokployDeployUrl: p.dokployDeployUrl || ''
    })))};
    
    // Project drawer functions
    function openProjectDrawer(projectId) {
      const project = PROJECTS_DATA.find(p => p.id === projectId);
      if (!project) return alert('Project not found');
      
      document.getElementById('editProjectId').value = project.id;
      document.getElementById('editProjectTitle').value = project.title;
      document.getElementById('editProjectDesc').value = project.description;
      document.getElementById('editProjectColor').value = project.color;
      document.getElementById('editProjectLead').value = project.projectLeadUserId;
      document.getElementById('editProjectDevLead').value = project.developerLeadUserId;
      document.getElementById('editProjectRepo').value = project.onedevUrl;
      document.getElementById('editProjectDeploy').value = project.dokployDeployUrl;
      
      // Show/hide external link buttons
      const repoLink = document.getElementById('editProjectRepoLink');
      const deployLink = document.getElementById('editProjectDeployLink');
      if (project.onedevUrl) { repoLink.href = project.onedevUrl; repoLink.style.display = 'inline-flex'; } else { repoLink.style.display = 'none'; }
      if (project.dokployDeployUrl) { deployLink.href = project.dokployDeployUrl; deployLink.style.display = 'inline-flex'; } else { deployLink.style.display = 'none'; }
      
      document.getElementById('projectDrawerOverlay').classList.add('open');
      document.getElementById('projectDrawer').classList.add('open');
    }
    
    function closeProjectDrawer() {
      document.getElementById('projectDrawerOverlay').classList.remove('open');
      document.getElementById('projectDrawer').classList.remove('open');
    }
    
    async function saveProject() {
      const id = document.getElementById('editProjectId').value;
      const title = document.getElementById('editProjectTitle').value.trim();
      const description = document.getElementById('editProjectDesc').value.trim() || null;
      const color = document.getElementById('editProjectColor').value;
      const projectLeadUserId = document.getElementById('editProjectLead').value || null;
      const developerLeadUserId = document.getElementById('editProjectDevLead').value || null;
      const onedevUrl = document.getElementById('editProjectRepo').value.trim() || null;
      const dokployDeployUrl = document.getElementById('editProjectDeploy').value.trim() || null;
      
      if (!title) return alert('Project name is required');
      
      const url = UI_KEY ? '/ui/' + UI_KEY + '/swarm/projects/' + id : '/api/swarm/projects/' + id;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, color, projectLeadUserId, developerLeadUserId, onedevUrl, dokployDeployUrl })
      });
      
      if (res.ok) {
        closeProjectDrawer();
        location.reload();
      } else {
        const err = await res.json();
        alert('Error: ' + (err.error || 'Failed to update project'));
      }
    }
    
    // Copy URL to clipboard
    async function copyUrl(url, btn) {
      let success = false;
      if (navigator?.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(url); success = true; } catch {}
      }
      if (!success) {
        const ta = document.createElement('textarea');
        ta.value = url; ta.style.cssText = 'position:fixed;left:-9999px';
        document.body.appendChild(ta); ta.select();
        try { success = document.execCommand('copy'); } catch {}
        document.body.removeChild(ta);
      }
      if (success && btn) {
        const orig = btn.innerHTML;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
        btn.style.color = '#22c55e';
        setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; }, 1500);
      }
    }
    
    // Sidebar toggle for mobile
    function toggleSidebar() {
      document.getElementById('sidebar').classList.toggle('open');
      document.getElementById('sidebarOverlay').classList.toggle('open');
    }
    
    // Toggle task expansion
    function toggleTaskExpand(card) {
      // Close other expanded cards
      document.querySelectorAll('.task-card.expanded').forEach(c => {
        if (c !== card) c.classList.remove('expanded');
      });
      // Toggle this card
      card.classList.toggle('expanded');
    }
    
    // Toggle project form
    function toggleProjectForm() {
      const form = document.getElementById('projectForm');
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
    }
    
    // Create project
    async function createProject() {
      const title = document.getElementById('newProjectTitle').value.trim();
      const description = document.getElementById('newProjectDesc').value.trim() || null;
      const color = document.getElementById('newProjectColor').value;
      const projectLeadUserId = document.getElementById('newProjectLead').value;
      const developerLeadUserId = document.getElementById('newProjectDevLead').value;
      const onedevUrl = document.getElementById('newProjectRepoUrl').value.trim() || null;
      const dokployDeployUrl = document.getElementById('newProjectDeployUrl').value.trim() || null;
      
      if (!title) return alert('Project name is required');
      if (!projectLeadUserId) return alert('Project Lead is required');
      if (!developerLeadUserId) return alert('Dev Lead is required');
      
      const url = UI_KEY ? '/ui/' + UI_KEY + '/swarm/projects' : '/api/swarm/projects';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, color, projectLeadUserId, developerLeadUserId, onedevUrl, dokployDeployUrl })
      });
      
      if (res.ok) {
        location.reload();
      } else {
        const err = await res.json();
        alert('Error: ' + (err.error || 'Failed to create project'));
      }
    }
    
    // Toggle all filters in a section
    function toggleAllFilters(filterType, checked) {
      document.querySelectorAll('[data-filter="' + filterType + '"]').forEach(cb => {
        cb.checked = checked;
        cb.closest('.filter-option').classList.toggle('checked', checked);
      });
      applyFilters();
    }
    
    // Theme
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') document.body.classList.add('light');
    function toggleTheme() {
      document.body.classList.toggle('light');
      localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark');
    }
    
    // Logout
    function logout() {
      localStorage.removeItem('mailboxKey');
      window.location.href = '/ui/swarm';
    }
    
    // Create form toggle
    function toggleCreateForm() {
      const form = document.getElementById('createForm');
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
    }
    
    // Preset views
    const CURRENT_USER = '${identity || ""}';
    function applyPreset(preset) {
      // Reset all filters first
      document.querySelectorAll('[data-filter]').forEach(cb => {
        cb.checked = true;
        cb.closest('.filter-option')?.classList.add('checked');
      });
      const showFutureEl = document.getElementById('showFuture');
      if (showFutureEl) showFutureEl.checked = false;
      document.getElementById('sortSelect').value = 'planned';
      
      if (preset === 'my-tasks' && CURRENT_USER) {
        document.querySelectorAll('[data-filter="assignee"]').forEach(cb => {
          const match = cb.value === CURRENT_USER;
          cb.checked = match;
          cb.closest('.filter-option')?.classList.toggle('checked', match);
        });
      } else if (preset === 'ready-next') {
        document.querySelectorAll('[data-filter="status"]').forEach(cb => {
          const match = cb.value === 'ready';
          cb.checked = match;
          cb.closest('.filter-option')?.classList.toggle('checked', match);
        });
      } else if (preset === 'unassigned') {
        document.querySelectorAll('[data-filter="assignee"]').forEach(cb => {
          const match = cb.value === 'unassigned';
          cb.checked = match;
          cb.closest('.filter-option')?.classList.toggle('checked', match);
        });
      }
      applyFilters();
    }
    
    // Filter handling
    document.querySelectorAll('[data-filter]').forEach(cb => {
      cb.addEventListener('change', () => {
        cb.closest('.filter-option').classList.toggle('checked', cb.checked);
        applyFilters();
      });
    });
    
    function applyFilters() {
      const statuses = [...document.querySelectorAll('[data-filter="status"]:checked')].map(cb => cb.value);
      const assignees = [...document.querySelectorAll('[data-filter="assignee"]:checked')].map(cb => cb.value);
      const projects = [...document.querySelectorAll('[data-filter="project"]:checked')].map(cb => cb.value);
      const showFuture = document.getElementById('showFuture')?.checked || false;
      const sortValue = document.getElementById('sortSelect')?.value || 'planned';
      
      // Filter cards
      document.querySelectorAll('.task-card').forEach(card => {
        const status = card.dataset.status;
        const assignee = card.dataset.assignee || 'unassigned';
        const project = card.dataset.project || 'none';
        const isFuture = card.dataset.future === 'true';
        
        const statusMatch = statuses.includes(status);
        const assigneeMatch = assignees.includes(assignee);
        const projectMatch = projects.includes(project);
        const futureMatch = showFuture || !isFuture;
        
        card.style.display = (statusMatch && assigneeMatch && projectMatch && futureMatch) ? 'flex' : 'none';
      });
      
      // Sort cards
      const taskList = document.getElementById('taskList');
      const cards = [...taskList.querySelectorAll('.task-card')];
      const statusOrder = { in_progress: 1, review: 2, ready: 3, queued: 4, holding: 5, complete: 6 };
      
      cards.sort((a, b) => {
        if (sortValue === 'planned') {
          const statusA = statusOrder[a.dataset.status] || 99;
          const statusB = statusOrder[b.dataset.status] || 99;
          if (statusA !== statusB) return statusA - statusB;
          const sortKeyA = parseInt(a.dataset.sortKey) || 0;
          const sortKeyB = parseInt(b.dataset.sortKey) || 0;
          if (sortKeyA !== sortKeyB) return sortKeyA - sortKeyB;
          return parseInt(a.dataset.created) - parseInt(b.dataset.created);
        } else if (sortValue === 'createdAt-desc') {
          return parseInt(b.dataset.created) - parseInt(a.dataset.created);
        } else if (sortValue === 'createdAt-asc') {
          return parseInt(a.dataset.created) - parseInt(b.dataset.created);
        } else if (sortValue === 'updatedAt-desc') {
          return parseInt(b.dataset.updated) - parseInt(a.dataset.updated);
        } else if (sortValue === 'updatedAt-asc') {
          return parseInt(a.dataset.updated) - parseInt(b.dataset.updated);
        }
        return 0;
      });
      cards.forEach(card => taskList.appendChild(card));
    }
    
    // Save task edits
    async function saveTask(id) {
      const title = document.getElementById('edit-title-' + id).value.trim();
      const projectId = document.getElementById('edit-project-' + id).value || null;
      const assigneeUserId = document.getElementById('edit-assignee-' + id).value || null;
      const detail = document.getElementById('edit-detail-' + id).value.trim() || null;
      const issueUrl = document.getElementById('edit-issueUrl-' + id).value.trim() || null;
      const mustBeDoneAfterTaskId = document.getElementById('edit-dependency-' + id).value || null;
      const nextTaskId = document.getElementById('edit-nextTask-' + id).value || null;
      const onOrAfterInput = document.getElementById('edit-onOrAfter-' + id).value;
      const onOrAfterAt = onOrAfterInput ? new Date(onOrAfterInput).toISOString() : null;
      
      if (!title) return alert('Title is required');
      
      const url = UI_KEY ? '/ui/' + UI_KEY + '/swarm/tasks/' + id : '/api/swarm/tasks/' + id;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, projectId, assigneeUserId, detail, issueUrl, mustBeDoneAfterTaskId, nextTaskId, onOrAfterAt })
      });
      
      if (res.ok) {
        location.reload();
      } else {
        const err = await res.json();
        alert('Error: ' + (err.error || 'Failed to save'));
      }
    }
    
    // Task actions - use UI-keyed endpoints when we have a key
    async function claimTask(id) {
      const url = UI_KEY ? '/ui/' + UI_KEY + '/swarm/tasks/' + id + '/claim' : '/api/swarm/tasks/' + id + '/claim';
      await fetch(url, { method: 'POST' });
      location.reload();
    }
    
    async function updateStatus(id, status) {
      const url = UI_KEY ? '/ui/' + UI_KEY + '/swarm/tasks/' + id + '/status' : '/api/swarm/tasks/' + id + '/status';
      await fetch(url, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      location.reload();
    }
    
    async function moveTask(id, direction) {
      const cards = [...document.querySelectorAll('.task-card')].filter(c => c.style.display !== 'none');
      const idx = cards.findIndex(c => c.dataset.id === id);
      if (idx === -1) return;
      
      let beforeTaskId = null;
      if (direction === 'up' && idx > 0) {
        beforeTaskId = cards[idx - 1].dataset.id;
      } else if (direction === 'down' && idx < cards.length - 1) {
        beforeTaskId = idx + 2 < cards.length ? cards[idx + 2].dataset.id : null;
      } else {
        return;
      }
      
      const url = UI_KEY ? '/ui/' + UI_KEY + '/swarm/tasks/' + id + '/reorder' : '/api/swarm/tasks/' + id + '/reorder';
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beforeTaskId })
      });
      location.reload();
    }
    
    async function createTask() {
      const title = document.getElementById('newTaskTitle').value.trim();
      if (!title) return alert('Title is required');
      
      const projectId = document.getElementById('newTaskProject').value || null;
      const assigneeUserId = document.getElementById('newTaskAssignee').value || null;
      const detail = document.getElementById('newTaskDetail').value.trim() || null;
      const issueUrl = document.getElementById('newTaskIssueUrl').value.trim() || null;
      const onOrAfterInput = document.getElementById('newTaskOnOrAfter').value;
      const onOrAfterAt = onOrAfterInput ? new Date(onOrAfterInput).toISOString() : null;
      
      const url = UI_KEY ? '/ui/' + UI_KEY + '/swarm/tasks' : '/api/swarm/tasks';
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, projectId, assigneeUserId, detail, issueUrl, onOrAfterAt })
      });
      location.reload();
    }
    
    // SSE: Listen for swarm events and refresh on changes from other users
    if (UI_KEY) {
      const currentUser = '${identity || ""}';
      let sseRetryTimeout = null;
      let lastReload = 0;
      function connectSwarmSSE() {
        const es = new EventSource('/ui/stream?key=' + UI_KEY);
        es.addEventListener('swarm', (e) => {
          try {
            const data = JSON.parse(e.data);
            // Skip if this is our own action (we already reload after our actions)
            if (data.actor === currentUser) return;
            // Debounce: don't reload more than once per 2 seconds
            const now = Date.now();
            if (now - lastReload < 2000) return;
            lastReload = now;
            location.reload();
          } catch {}
        });
        es.onerror = () => {
          es.close();
          if (sseRetryTimeout) clearTimeout(sseRetryTimeout);
          sseRetryTimeout = setTimeout(connectSwarmSSE, 5000);
        };
      }
      connectSwarmSSE();
    }
  </script>
</body>
</html>`;
}

const server = Bun.serve({
  port: PORT,
  fetch: handleRequest,
});

// Connect Swarm Buzz events to broadcast listeners
setSwarmBuzzListener((event) => {
  broadcastToListeners(event);
});

console.log(`[hive] Listening on http://localhost:${PORT}`);

process.on("SIGINT", async () => {
  console.log("\n[hive] Shutting down...");
  await close();
  process.exit(0);
});

// ============================================================
// SWARM HANDLERS - Task Management
// ============================================================

function serializeProject(p: swarm.SwarmProject) {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    onedevUrl: p.onedevUrl,
    dokployDeployUrl: p.dokployDeployUrl,
    color: p.color,
    projectLeadUserId: p.projectLeadUserId,
    developerLeadUserId: p.developerLeadUserId,
    archivedAt: p.archivedAt?.toISOString() || null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function serializeTask(t: swarm.SwarmTask) {
  return {
    id: t.id,
    projectId: t.projectId,
    title: t.title,
    detail: t.detail,
    creatorUserId: t.creatorUserId,
    assigneeUserId: t.assigneeUserId,
    status: t.status,
    onOrAfterAt: t.onOrAfterAt?.toISOString() || null,
    mustBeDoneAfterTaskId: t.mustBeDoneAfterTaskId,
    sortKey: t.sortKey,
    nextTaskId: t.nextTaskId,
    nextTaskAssigneeUserId: t.nextTaskAssigneeUserId,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    completedAt: t.completedAt?.toISOString() || null,
    blockedReason: t.blockedReason || null,
  };
}

function serializeTaskEvent(e: swarm.SwarmTaskEvent) {
  return {
    id: e.id,
    taskId: e.taskId,
    actorUserId: e.actorUserId,
    kind: e.kind,
    beforeState: e.beforeState,
    afterState: e.afterState,
    createdAt: e.createdAt.toISOString(),
  };
}

// Projects
async function handleSwarmListProjects(auth: AuthContext): Promise<Response> {
  try {
    const includeArchived = false; // TODO: add query param support
    const projects = await swarm.listProjects({ includeArchived });
    return json({ projects: projects.map(serializeProject) });
  } catch (err) {
    console.error("[swarm] List projects error:", err);
    return error("Failed to list projects", 500);
  }
}

async function handleSwarmCreateProject(auth: AuthContext, request: Request): Promise<Response> {
  try {
    const body = await request.json() as swarm.CreateProjectInput;
    
    if (!body.title || !body.color || !body.projectLeadUserId || !body.developerLeadUserId) {
      return error("title, color, projectLeadUserId, and developerLeadUserId are required", 400);
    }
    
    // Validate color format
    if (!/^#[0-9A-Fa-f]{6}$/.test(body.color)) {
      return error("color must be a valid hex color (e.g., #FF5500)", 400);
    }
    
    const project = await swarm.createProject(body);
    
    // Emit Buzz event
    await emitSwarmBuzz("swarm.project.created", {
      projectId: project.id,
      title: project.title,
      actor: auth.identity,
    });
    
    return json({ project: serializeProject(project) }, 201);
  } catch (err) {
    console.error("[swarm] Create project error:", err);
    return error("Failed to create project", 500);
  }
}

async function handleSwarmGetProject(auth: AuthContext, id: string): Promise<Response> {
  const project = await swarm.getProject(id);
  if (!project) {
    return error("Project not found", 404);
  }
  return json({ project: serializeProject(project) });
}

async function handleSwarmUpdateProject(auth: AuthContext, id: string, request: Request): Promise<Response> {
  try {
    const body = await request.json() as swarm.UpdateProjectInput;
    
    if (body.color && !/^#[0-9A-Fa-f]{6}$/.test(body.color)) {
      return error("color must be a valid hex color (e.g., #FF5500)", 400);
    }
    
    const project = await swarm.updateProject(id, body);
    if (!project) {
      return error("Project not found", 404);
    }
    
    await emitSwarmBuzz("swarm.project.updated", {
      projectId: project.id,
      title: project.title,
      actor: auth.identity,
    });
    
    return json({ project: serializeProject(project) });
  } catch (err) {
    console.error("[swarm] Update project error:", err);
    return error("Failed to update project", 500);
  }
}

async function handleSwarmArchiveProject(auth: AuthContext, id: string): Promise<Response> {
  const project = await swarm.archiveProject(id);
  if (!project) {
    return error("Project not found", 404);
  }
  
  await emitSwarmBuzz("swarm.project.archived", {
    projectId: project.id,
    title: project.title,
    actor: auth.identity,
  });
  
  return json({ project: serializeProject(project) });
}

async function handleSwarmUnarchiveProject(auth: AuthContext, id: string): Promise<Response> {
  const project = await swarm.unarchiveProject(id);
  if (!project) {
    return error("Project not found", 404);
  }
  
  await emitSwarmBuzz("swarm.project.unarchived", {
    projectId: project.id,
    title: project.title,
    actor: auth.identity,
  });
  
  return json({ project: serializeProject(project) });
}

// Tasks
async function handleSwarmListTasks(auth: AuthContext, request: Request): Promise<Response> {
  const url = new URL(request.url);
  
  const opts: swarm.ListTasksOptions = {
    statuses: url.searchParams.getAll("status") as swarm.TaskStatus[],
    assignees: url.searchParams.getAll("assignee"),
    includeUnassigned: url.searchParams.get("unassigned") === "true",
    projects: url.searchParams.getAll("project"),
    includeNoProject: url.searchParams.get("noProject") === "true",
    creatorUserId: url.searchParams.get("creator") || undefined,
    query: url.searchParams.get("q") || undefined,
    includeFuture: url.searchParams.get("includeFuture") === "true",
    includeCompleted: url.searchParams.get("includeCompleted") === "true",
    sort: (url.searchParams.get("sort") as "planned" | "createdAt" | "updatedAt") || "planned",
    sortDir: (url.searchParams.get("dir") as "asc" | "desc") || "asc",
    limit: parseInt(url.searchParams.get("limit") || "100"),
  };
  
  // Clean empty arrays
  if (opts.statuses?.length === 0) delete opts.statuses;
  if (opts.assignees?.length === 0) delete opts.assignees;
  if (opts.projects?.length === 0) delete opts.projects;
  
  let tasks = await swarm.listTasks(opts);
  tasks = await swarm.enrichTasksWithBlocked(tasks);
  
  return json({ tasks: tasks.map(serializeTask) });
}

async function handleSwarmCreateTask(auth: AuthContext, request: Request): Promise<Response> {
  try {
    const body = await request.json() as Omit<swarm.CreateTaskInput, "creatorUserId">;
    
    if (!body.title) {
      return error("title is required", 400);
    }
    
    const task = await swarm.createTask({
      ...body,
      creatorUserId: auth.identity,
      onOrAfterAt: body.onOrAfterAt ? new Date(body.onOrAfterAt as unknown as string) : undefined,
    });
    
    // Record event
    await swarm.createTaskEvent({
      taskId: task.id,
      actorUserId: auth.identity,
      kind: "created",
      afterState: serializeTask(task),
    });
    
    // Emit Buzz
    emitSwarmBuzz({
      eventType: 'swarm.task.created',
      taskId: task.id,
      projectId: task.projectId || undefined,
      title: task.title,
      actor: auth.identity,
      assignee: task.assigneeUserId,
      status: task.status,
      deepLink: getSwarmDeepLink(task.id),
    });
    
    return json({ task: serializeTask(task) }, 201);
  } catch (err) {
    console.error("[swarm] Create task error:", err);
    return error("Failed to create task", 500);
  }
}

async function handleSwarmGetTask(auth: AuthContext, id: string): Promise<Response> {
  const task = await swarm.getTask(id);
  if (!task) {
    return error("Task not found", 404);
  }
  await swarm.enrichTaskWithBlocked(task);
  return json({ task: serializeTask(task) });
}

async function handleSwarmUpdateTask(auth: AuthContext, id: string, request: Request): Promise<Response> {
  try {
    const body = await request.json() as swarm.UpdateTaskInput;
    
    const before = await swarm.getTask(id);
    if (!before) {
      return error("Task not found", 404);
    }
    
    // Handle date conversion
    if (body.onOrAfterAt) {
      body.onOrAfterAt = new Date(body.onOrAfterAt as unknown as string);
    }
    
    const task = await swarm.updateTask(id, body);
    if (!task) {
      return error("Task not found", 404);
    }
    
    await swarm.createTaskEvent({
      taskId: id,
      actorUserId: auth.identity,
      kind: "updated",
      beforeState: serializeTask(before),
      afterState: serializeTask(task),
    });
    
    emitSwarmBuzz({
      eventType: 'swarm.task.updated',
      taskId: task.id,
      projectId: task.projectId || undefined,
      title: task.title,
      actor: auth.identity,
      assignee: task.assigneeUserId,
      status: task.status,
      deepLink: getSwarmDeepLink(task.id),
    });
    
    await swarm.enrichTaskWithBlocked(task);
    return json({ task: serializeTask(task) });
  } catch (err) {
    console.error("[swarm] Update task error:", err);
    return error("Failed to update task", 500);
  }
}

async function handleSwarmClaimTask(auth: AuthContext, id: string): Promise<Response> {
  const task = await swarm.claimTask(id, auth.identity);
  if (!task) {
    return error("Task not found", 404);
  }
  
  emitSwarmBuzz({
    eventType: 'swarm.task.assigned',
    taskId: task.id,
    projectId: task.projectId || undefined,
    title: task.title,
    actor: auth.identity,
    assignee: auth.identity,
    status: task.status,
    deepLink: getSwarmDeepLink(task.id),
  });
  
  await swarm.enrichTaskWithBlocked(task);
  return json({ task: serializeTask(task) });
}

async function handleSwarmUpdateTaskStatus(auth: AuthContext, id: string, request: Request): Promise<Response> {
  try {
    const body = await request.json() as { status: swarm.TaskStatus };
    
    if (!body.status) {
      return error("status is required", 400);
    }
    
    const validStatuses: swarm.TaskStatus[] = ["queued", "ready", "in_progress", "holding", "review", "complete"];
    if (!validStatuses.includes(body.status)) {
      return error(`status must be one of: ${validStatuses.join(", ")}`, 400);
    }
    
    // Check if task is blocked
    const current = await swarm.getTask(id);
    if (!current) {
      return error("Task not found", 404);
    }
    
    await swarm.enrichTaskWithBlocked(current);
    
    // Prevent transitioning blocked tasks to active states
    if (current.blockedReason && ["in_progress", "review", "complete"].includes(body.status)) {
      return error(`Cannot transition to ${body.status}: task is blocked by ${current.blockedReason}`, 400);
    }
    
    const task = await swarm.updateTaskStatus(id, body.status, auth.identity);
    if (!task) {
      return error("Task not found", 404);
    }
    
    const eventType = body.status === "complete" ? 'swarm.task.completed' : 'swarm.task.status_changed';
    emitSwarmBuzz({
      eventType: eventType as SwarmBuzzEventType,
      taskId: task.id,
      projectId: task.projectId || undefined,
      title: task.title,
      actor: auth.identity,
      assignee: task.assigneeUserId,
      status: task.status,
      deepLink: getSwarmDeepLink(task.id),
    });
    
    await swarm.enrichTaskWithBlocked(task);
    return json({ task: serializeTask(task) });
  } catch (err) {
    console.error("[swarm] Update task status error:", err);
    return error("Failed to update task status", 500);
  }
}

async function handleSwarmGetTaskEvents(auth: AuthContext, id: string): Promise<Response> {
  const task = await swarm.getTask(id);
  if (!task) {
    return error("Task not found", 404);
  }
  
  const events = await swarm.getTaskEvents(id);
  return json({ events: events.map(serializeTaskEvent) });
}

// API handler for reordering tasks
async function handleSwarmReorderTask(auth: AuthContext, id: string, request: Request): Promise<Response> {
  let body: { beforeTaskId?: string | null };
  try {
    body = await request.json();
  } catch {
    return error("Invalid JSON", 400);
  }
  
  try {
    const task = await swarm.reorderTask(id, body.beforeTaskId || null, auth.identity);
    
    if (!task) {
      return error("Task not found", 404);
    }
    
    // Emit Buzz event
    emitSwarmBuzz({
      eventType: 'swarm.task.reordered',
      taskId: task.id,
      projectId: task.projectId || undefined,
      title: task.title,
      actor: auth.identity,
      assignee: task.assigneeUserId,
      status: task.status,
      deepLink: getSwarmDeepLink(task.id),
    });
    
    return json({ task: serializeTask(task) });
  } catch (err) {
    console.error("[api] Error reordering task:", err);
    const message = err instanceof Error ? err.message : "Failed to reorder task";
    return error(message, 500);
  }
}

// ============================================================
// RECURRING TEMPLATES HANDLERS
// ============================================================

async function handleListTemplates(auth: AuthContext, request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") || undefined;
    const enabled = url.searchParams.get("enabled");
    const ownerUserId = url.searchParams.get("ownerUserId") || undefined;
    
    // DEBUG: Test raw query first
    const { sql } = await import("./db/client");
    const rawRows = await sql`SELECT id, title, owner_user_id FROM public.swarm_recurring_templates LIMIT 5`;
    console.log("[api] Raw rows:", JSON.stringify(rawRows));
    
    const templates = await swarm.listTemplates({
      projectId,
      enabled: enabled !== null ? enabled === "true" : undefined,
      ownerUserId,
    });
    
    return json({ templates, debug: { rawCount: rawRows.length } });
  } catch (err) {
    console.error("[api] Error listing templates:", err);
    return error("Failed to list templates: " + String(err), 500);
  }
}

async function handleCreateTemplate(auth: AuthContext, request: Request): Promise<Response> {
  try {
    const body = await request.json() as Omit<swarm.CreateTemplateInput, "ownerUserId"> & { ownerUserId?: string };
    
    if (!body.title) return error("title is required", 400);
    if (!body.startAt) return error("startAt is required", 400);
    if (!body.everyInterval) return error("everyInterval is required", 400);
    if (!body.everyUnit) return error("everyUnit is required", 400);
    
    const template = await swarm.createTemplate({
      ...body,
      ownerUserId: body.ownerUserId || auth.identity,
      startAt: new Date(body.startAt as unknown as string),
      endAt: body.endAt ? new Date(body.endAt as unknown as string) : undefined,
    });
    
    return json({ template }, 201);
  } catch (err) {
    console.error("[api] Error creating template:", err);
    return error("Failed to create template", 500);
  }
}

async function handleGetTemplate(id: string): Promise<Response> {
  const template = await swarm.getTemplate(id);
  if (!template) return error("Template not found", 404);
  return json({ template });
}

async function handleUpdateTemplate(auth: AuthContext, id: string, request: Request): Promise<Response> {
  try {
    const body = await request.json() as swarm.UpdateTemplateInput;
    
    if (body.startAt) body.startAt = new Date(body.startAt as unknown as string);
    if (body.endAt) body.endAt = new Date(body.endAt as unknown as string);
    
    const template = await swarm.updateTemplate(id, body);
    if (!template) return error("Template not found", 404);
    
    return json({ template });
  } catch (err) {
    console.error("[api] Error updating template:", err);
    return error("Failed to update template", 500);
  }
}

async function handleDeleteTemplate(id: string): Promise<Response> {
  const deleted = await swarm.deleteTemplate(id);
  if (!deleted) return error("Template not found", 404);
  return json({ success: true });
}

async function handleEnableTemplate(id: string): Promise<Response> {
  const template = await swarm.enableTemplate(id);
  if (!template) return error("Template not found", 404);
  return json({ template });
}

async function handleDisableTemplate(id: string): Promise<Response> {
  const template = await swarm.disableTemplate(id);
  if (!template) return error("Template not found", 404);
  return json({ template });
}

async function handleRunGenerator(auth: AuthContext, request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const templateId = url.searchParams.get("templateId") || undefined;
    
    const result = await runRecurringGenerator(templateId);
    return json(result);
  } catch (err) {
    console.error("[api] Error running generator:", err);
    return error("Failed to run generator", 500);
  }
}

// Simple generator implementation
async function runRecurringGenerator(templateId?: string): Promise<{ generated: number; errors: string[] }> {
  const templates = templateId 
    ? [await swarm.getTemplate(templateId)].filter(Boolean) as swarm.RecurringTemplate[]
    : await swarm.listTemplates({ enabled: true });
  
  let generated = 0;
  const errors: string[] = [];
  const now = new Date();
  const horizonDays = 14;
  const maxInstancesPerTemplate = 10;
  const horizon = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);
  
  for (const template of templates) {
    try {
      // Skip if template hasn't started yet
      if (template.startAt > now) continue;
      
      // Skip if template has ended
      if (template.endAt && template.endAt < now) continue;
      
      // Find next occurrence(s) to generate
      let cursor = template.lastRunAt || template.startAt;
      let instancesGenerated = 0;
      
      while (instancesGenerated < maxInstancesPerTemplate) {
        const next = computeNextOccurrence(template, cursor);
        if (!next || next > horizon) break;
        if (template.endAt && next > template.endAt) break;
        
        // Check repeat count
        if (template.repeatCount) {
          const existingCount = await countTemplateInstances(template.id);
          if (existingCount >= template.repeatCount) break;
        }
        
        // Try to create instance (idempotent via unique constraint)
        const created = await createRecurringInstance(template, next);
        if (created) {
          generated++;
          instancesGenerated++;
        }
        
        cursor = next;
      }
      
      // Update lastRunAt
      if (instancesGenerated > 0) {
        await swarm.updateTemplate(template.id, { lastRunAt: now });
      }
    } catch (err) {
      const msg = `Template ${template.id}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      console.error("[generator]", msg);
    }
  }
  
  return { generated, errors };
}

function computeNextOccurrence(template: swarm.RecurringTemplate, after: Date): Date | null {
  // Simple implementation - add interval to cursor
  const { everyInterval, everyUnit, daysOfWeek, weekParity, betweenHoursStart, betweenHoursEnd } = template;
  
  let next = new Date(after);
  
  // Add interval
  switch (everyUnit) {
    case 'minute': next.setMinutes(next.getMinutes() + everyInterval); break;
    case 'hour': next.setHours(next.getHours() + everyInterval); break;
    case 'day': next.setDate(next.getDate() + everyInterval); break;
    case 'week': next.setDate(next.getDate() + everyInterval * 7); break;
    case 'month': next.setMonth(next.getMonth() + everyInterval); break;
  }
  
  // Apply day-of-week constraint (simple: advance to next matching day)
  if (daysOfWeek && daysOfWeek.length > 0) {
    const dayMap: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    const allowedDays = daysOfWeek.map(d => dayMap[d.toLowerCase()]).filter(n => n !== undefined);
    
    let attempts = 0;
    while (!allowedDays.includes(next.getDay()) && attempts < 7) {
      next.setDate(next.getDate() + 1);
      attempts++;
    }
  }
  
  // Apply week parity constraint
  if (weekParity !== 'any') {
    const weekNum = getISOWeekNumber(next);
    const isOdd = weekNum % 2 === 1;
    const wantOdd = weekParity === 'odd';
    
    if (isOdd !== wantOdd) {
      // Move to next week
      next.setDate(next.getDate() + 7);
    }
  }
  
  // Apply between-hours constraint (simple: set to start hour if outside window)
  if (betweenHoursStart !== null && betweenHoursEnd !== null) {
    const hour = next.getHours();
    const inWindow = betweenHoursStart <= betweenHoursEnd
      ? (hour >= betweenHoursStart && hour < betweenHoursEnd)
      : (hour >= betweenHoursStart || hour < betweenHoursEnd);
    
    if (!inWindow) {
      next.setHours(betweenHoursStart, 0, 0, 0);
      if (next <= after) {
        next.setDate(next.getDate() + 1);
      }
    }
  }
  
  return next;
}

function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

async function countTemplateInstances(templateId: string): Promise<number> {
  const result = await import("./db/client").then(m => m.sql`
    SELECT COUNT(*) as count FROM public.swarm_tasks 
    WHERE recurring_template_id = ${templateId}
  `);
  return Number(result[0]?.count || 0);
}

async function createRecurringInstance(template: swarm.RecurringTemplate, scheduledAt: Date): Promise<boolean> {
  try {
    const { sql } = await import("./db/client");
    
    // Use ON CONFLICT DO NOTHING for idempotency
    const result = await sql`
      INSERT INTO public.swarm_tasks (
        recurring_template_id, recurring_instance_at,
        project_id, title, detail, creator_user_id, assignee_user_id, status
      ) VALUES (
        ${template.id},
        ${scheduledAt},
        ${template.projectId},
        ${template.title},
        ${template.detail},
        ${template.ownerUserId},
        ${template.primaryAgent},
        'queued'
      )
      ON CONFLICT (recurring_template_id, recurring_instance_at) 
      WHERE recurring_template_id IS NOT NULL
      DO NOTHING
      RETURNING id
    `;
    
    return result.length > 0;
  } catch (err) {
    console.error("[generator] Failed to create instance:", err);
    return false;
  }
}

// Skill endpoint - returns SKILL.md content
async function handleSkill(): Promise<Response> {
  try {
    // Try multiple paths
    const paths = [
      "./SKILL.md",
      "../SKILL.md",
      "/app/SKILL.md",
      new URL("../SKILL.md", import.meta.url).pathname,
    ];
    
    for (const p of paths) {
      const file = Bun.file(p);
      if (await file.exists()) {
        const content = await file.text();
        return new Response(content, {
          headers: { "Content-Type": "text/markdown" },
        });
      }
    }
    
    return new Response("# Mailbox API Skill\n\nSKILL.md not found.", {
      status: 404,
      headers: { "Content-Type": "text/markdown" },
    });
  } catch (err) {
    console.error("[api] Skill endpoint error:", err);
    return new Response("# Mailbox API Skill\n\nError loading skill.", {
      status: 500,
      headers: { "Content-Type": "text/markdown" },
    });
  }
}

// SSE stream for real-time message notifications
async function handleStream(auth: AuthContext): Promise<Response> {
  const recipient = auth.identity;
  const connId = generateConnectionId();
  
  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      
      // Track presence for this authenticated user
      addPresence(connId, recipient, 'api');
      
      // Send initial connection event with presence info
      controller.enqueue(encoder.encode(`: connected to mailbox stream for ${recipient}\n\n`));
      getPresenceInfo().then(presence => {
        try {
          controller.enqueue(encoder.encode(`event: presence\ndata: ${JSON.stringify({ presence })}\n\n`));
        } catch { /* stream may be closed */ }
      });
      
      // Listen for presence changes
      const presenceHandler: PresenceListener = (event) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: presence\ndata: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };
      presenceListeners.add(presenceHandler);
      
      // Ping every 30 seconds to keep connection alive
      const pingInterval = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          closed = true;
          clearInterval(pingInterval);
        }
      }, 30000);
      
      // Subscribe to real-time events for this mailbox (instant delivery)
      const unsubscribe = subscribe(recipient, (event: MailboxEvent) => {
        if (closed) return;
        try {
          if (event.type === "message") {
            const data = {
              id: event.messageId,
              sender: event.sender,
              title: event.title,
              urgent: event.urgent,
            };
            controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(data)}\n\n`));
          } else if (event.type === "inbox_check") {
            const data = {
              mailbox: event.mailbox,
              action: event.action,
              timestamp: new Date().toISOString(),
            };
            controller.enqueue(encoder.encode(`event: inbox_check\ndata: ${JSON.stringify(data)}\n\n`));
          }
        } catch (err) {
          console.error("[sse] Event send error:", err);
          closed = true;
        }
      });
      
      // Cleanup on close
      return () => {
        closed = true;
        clearInterval(pingInterval);
        unsubscribe();
        presenceListeners.delete(presenceHandler);
        removePresence(connId);
      };
    },
  });
  
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
