// Hive - Team Communication Hub
import { healthCheck, close } from "./db/client";
import { 
  sendMessage, listMessages, getMessage, 
  ackMessage, ackMessages, searchMessages,
  isValidMailbox, listAllMessages, getUnreadCounts,
  type SendMessageInput 
} from "./db/messages";
import { authenticate, initFromEnv, type AuthContext } from "./middleware/auth";
import { subscribe, emit, type MailboxEvent } from "./events";
import * as broadcast from "./db/broadcast";

const PORT = parseInt(process.env.PORT || "3100");

// Initialize auth tokens
initFromEnv();

// UI mailbox keys config (for compose feature)
type UIKeyConfig = { sender: string };
const uiMailboxKeys: Record<string, UIKeyConfig> = {};

function initUIKeys() {
  // UI_MAILBOX_KEYS='{"key1":{"sender":"chris"},...}'
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

type PresenceInfo = { user: string; online: boolean; lastSeen: number; unread: number };

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
  
  return allUsers.map(user => ({
    user,
    online: onlineUsers.includes(user),
    lastSeen: onlineUsers.includes(user) ? now : (userLastSeen.get(user) || 0),
    unread: unreadCounts[user] || 0
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
    .nav a { color: var(--muted-foreground); text-decoration: none; padding: 6px 12px; border-radius: var(--radius); font-size: 0.875rem; }
    .nav a:hover { background: var(--secondary); color: var(--foreground); }
    .nav a.active { background: var(--primary); color: var(--primary-foreground); }
    .theme-toggle { background: var(--secondary); border: none; color: var(--foreground); padding: 6px 10px; border-radius: var(--radius); cursor: pointer; font-size: 1rem; }
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
        <a href="/ui/broadcast">Buzz</a>
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
      const recipient = document.getElementById('recipient').value;
      const filterUrgent = document.getElementById('filterUrgent')?.checked || false;
      const filterUnread = document.getElementById('filterUnread')?.checked || false;
      const params = new URLSearchParams({ limit: '50' });
      if (recipient) params.set('recipient', recipient);
      if (filterUrgent) params.set('urgent', 'true');
      if (filterUnread) params.set('unread', 'true');
      
      const res = await fetch('/ui/messages?' + params);
      const data = await res.json();
      
      const container = document.getElementById('messages');
      if (data.messages.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:#888;padding:40px;">No messages match filters</div>';
      } else {
        container.innerHTML = data.messages.map(m => renderMessage(m)).join('');
      }
      
      if (data.messages.length > 0) {
        lastId = data.messages[0].id;
      }
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

  let messages = await listAllMessages({
    recipient,
    limit: urgentOnly || unreadOnly ? 200 : limit, // Fetch more if filtering
    sinceId: sinceId ? BigInt(sinceId) : undefined,
  });

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

// UI endpoint: SSE stream (no auth, internal only)
async function handleUIStream(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const recipient = url.searchParams.get("recipient") || undefined;
  const viewerParam = url.searchParams.get("viewer");
  // Only accept viewer if it's a valid user (prevents spoofing arbitrary names)
  const viewer = viewerParam && VALID_PRESENCE_USERS.includes(viewerParam.toLowerCase()) 
    ? viewerParam.toLowerCase() 
    : undefined;
  
  const connId = generateConnectionId();
  
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      
      // Track presence if viewer is specified and valid
      if (viewer) {
        addPresence(connId, viewer, 'ui');
      }
      
      // Send initial connection event with current presence
      controller.enqueue(encoder.encode(`: connected to UI stream\n\n`));
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
          const messages = await listAllMessages({ 
            recipient,
            limit: 10,
            sinceId: lastSeenId > 0n ? lastSeenId : undefined 
          });
          
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
async function handlePresence(): Promise<Response> {
  return json({ presence: await getPresenceInfo() });
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
    body { font-family: 'Nunito Sans', system-ui, sans-serif; background: var(--background); color: var(--foreground); padding: 16px; line-height: 1.5; }
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
    /* Theme toggle */
    .theme-toggle { position: fixed; top: 16px; right: 16px; background: transparent; border: none; font-size: 1.25rem; padding: 8px; cursor: pointer; z-index: 100; opacity: 0.7; transition: opacity 0.15s ease; }
    .theme-toggle:hover { opacity: 1; }
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
    body.light .presence-avatar img, body.light .presence-avatar .avatar-placeholder { opacity: 0.65; }
    body.light .presence-avatar.online img, body.light .presence-avatar.online .avatar-placeholder { opacity: 1; }
    body.light .presence-avatar.online .ring { border-color: #16a34a; box-shadow: 0 0 8px rgba(22,163,74,0.4); }
  </style>
</head>
<body>
  <div id="presenceIndicators"></div>
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
    <h1 style="margin-bottom: 0;">🐝 Hive - ${sender}</h1>
    <div style="display: flex; gap: 12px; align-items: center;">
      <a href="/ui" style="color: var(--primary); text-decoration: none; padding: 6px 12px; border-radius: var(--radius); background: var(--primary); color: var(--primary-foreground); font-size: 0.875rem; font-weight: 600;">Messages</a>
      <a href="/ui/broadcast" style="color: var(--muted-foreground); text-decoration: none; padding: 6px 12px; border-radius: var(--radius); font-size: 0.875rem;">Buzz</a>
    </div>
  </div>
  
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
  <button id="soundToggle" class="theme-toggle" style="right:56px" onclick="toggleSound()" title="Toggle notification sound">🔈</button>
  <button id="themeToggle" class="theme-toggle" onclick="toggleTheme()" title="Toggle light/dark mode"></button>
  <div id="messages" class="messages"></div>

  <script>
    const MAILBOX_KEY = '${key}';
    let eventSource = null;
    let lastId = null;
    let selectedMessage = null;
    let replyToId = null;
    const CURRENT_SENDER = '${sender}';

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

      return \`
        <div class="\${classes.join(' ')}" data-id="\${msg.id}" data-sender="\${msg.sender}" data-title="\${msg.title.replace(/"/g, '&quot;')}" onclick="selectMessage(this)">
          <div class="message-row">
            \${getAvatarHtml(msg.sender)}
            <div class="message-content">
              <div class="message-header">
                <span class="message-meta">
                  <span class="sender">\${msg.sender}</span> → <span class="recipient">\${msg.recipient}</span>
                </span>
                <span class="message-meta">\${formatDate(msg.createdAt)}\${markReadBtn}</span>
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
      const params = new URLSearchParams({ limit: '50' });
      if (recipient) params.set('recipient', recipient);
      if (filterUrgent) params.set('urgent', 'true');
      if (filterUnread) params.set('unread', 'true');
      
      const res = await fetch('/ui/messages?' + params);
      const data = await res.json();
      
      const container = document.getElementById('messages');
      if (data.messages.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:#888;padding:40px;">No messages match filters</div>';
      } else {
        container.innerHTML = data.messages.map(m => renderMessage(m)).join('');
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
    }

    // Track seen messages globally (persists across SSE reconnects)
    const seenMessageIds = new Set();
    let initialLoadComplete = false;

    function connectSSE() {
      const recipient = document.getElementById('recipient').value;
      // Include viewer param to track presence for current user
      let url = '/ui/stream?viewer=' + encodeURIComponent(CURRENT_SENDER);
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
    if (path === "/ui/presence") return handlePresence();
    
    // Broadcast UI tab (must be before keyed UI routes)
    if (path === "/ui/broadcast") return handleBroadcastUI();
    if (path === "/ui/broadcast/stream") return handleBroadcastUIStream(request);
    
    // Keyed UI with compose
    const uiKeyMatch = path.match(/^\/ui\/([a-zA-Z0-9_-]+)$/);
    const uiKeySendMatch = path.match(/^\/ui\/([a-zA-Z0-9_-]+)\/send$/);
    const uiKeyAckMatch = path.match(/^\/ui\/([a-zA-Z0-9_-]+)\/ack\/(\d+)$/);
    
    if (method === "GET" && uiKeyMatch) {
      return handleUIWithKey(uiKeyMatch[1]);
    }
    if (method === "POST" && uiKeySendMatch) {
      return handleUISend(uiKeySendMatch[1], request);
    }
    if (method === "POST" && uiKeyAckMatch) {
      return handleUIAck(uiKeyAckMatch[1], uiKeyAckMatch[2]);
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
    
    // Ingest endpoint (NO AUTH - public webhook endpoint)
    // Route: /api/ingest/{app_name}/{token} (path has /api stripped, so matches /ingest/...)
    const ingestMatch = path.match(/^\/ingest\/([a-z][a-z0-9_-]*)\/([a-f0-9]{14})$/);
    if (method === "POST" && ingestMatch) {
      return handleWebhookIngest(ingestMatch[1], ingestMatch[2], request);
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
    }
    .nav a:hover { background: var(--secondary); color: var(--foreground); }
    .nav a.active { background: var(--primary); color: var(--primary-foreground); }
    .theme-toggle {
      background: var(--secondary);
      border: none;
      color: var(--foreground);
      padding: 6px 10px;
      border-radius: var(--radius);
      cursor: pointer;
      font-size: 1rem;
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
        <a href="/ui/broadcast" class="active">Buzz</a>
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
      eventSource = new EventSource('/ui/broadcast/stream');
      
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

const server = Bun.serve({
  port: PORT,
  fetch: handleRequest,
});

console.log(`[hive] Listening on http://localhost:${PORT}`);

process.on("SIGINT", async () => {
  console.log("\n[hive] Shutting down...");
  await close();
  process.exit(0);
});

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
