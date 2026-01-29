// Mailbox API Server
import { healthCheck, close } from "./db/client";
import { 
  sendMessage, listMessages, getMessage, 
  ackMessage, ackMessages, searchMessages,
  isValidMailbox, listAllMessages, getUnreadCounts,
  type SendMessageInput 
} from "./db/messages";
import { authenticate, initFromEnv, type AuthContext } from "./middleware/auth";
import { subscribe, emit, type MailboxEvent } from "./events";

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
      console.log(`[mailbox-api] Loaded ${Object.keys(uiMailboxKeys).length} UI mailbox keys`);
    } catch (e) {
      console.error("[mailbox-api] Failed to parse UI_MAILBOX_KEYS:", e);
    }
  } else {
    console.log(`[mailbox-api] UI_MAILBOX_KEYS not configured - compose UI disabled`);
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

// Presence change listeners (SSE controllers that want presence updates)
type PresenceListener = (event: { type: 'join' | 'leave'; user: string; presence: PresenceInfo[] }) => void;
const presenceListeners = new Set<PresenceListener>();

type PresenceInfo = { user: string; online: boolean; lastSeen: number; unread: number };

function generateConnectionId(): string {
  return `conn_${++connectionIdCounter}_${Date.now()}`;
}

function getPresent(): string[] {
  const users = new Set<string>();
  for (const entry of activeConnections.values()) {
    users.add(entry.user);
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
  <link rel="icon" href="/ui/icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/ui/icon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700&display=swap" rel="stylesheet">
  <title>Mailbox</title>
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
    .presence-bar { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; padding: 10px 14px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); }
    .presence-bar .label { font-size: 0.6875rem; color: var(--muted-foreground); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; flex-shrink: 0; }
    #presenceIndicators { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
    .presence-avatar { position: relative; width: 32px; height: 32px; flex-shrink: 0; margin-bottom: 12px; }
    .presence-avatar img, .presence-avatar .avatar-placeholder { width: 32px; height: 32px; border-radius: 50%; font-size: 12px; }
    .presence-avatar .ring { position: absolute; inset: -3px; border-radius: 50%; border: 2px solid var(--muted); transition: all 0.2s ease; }
    .presence-avatar.online .ring { border-color: #22c55e; box-shadow: 0 0 10px rgba(34,197,94,0.4); }
    .presence-avatar .name { position: absolute; bottom: -12px; left: 50%; transform: translateX(-50%); font-size: 0.5625rem; color: var(--muted-foreground); white-space: nowrap; font-weight: 600; }
    .presence-avatar.online .name { color: #22c55e; }
    .filters { display: flex; gap: 12px; align-items: center; }
    .filter-label { display: flex; align-items: center; gap: 6px; font-size: 0.8125rem; color: var(--muted-foreground); cursor: pointer; }
    .filter-label input { cursor: pointer; accent-color: var(--primary); }
    .theme-toggle { position: fixed; top: 16px; right: 16px; background: transparent; border: none; font-size: 1.25rem; padding: 8px; cursor: pointer; z-index: 100; opacity: 0.7; transition: opacity 0.15s ease; }
    .theme-toggle:hover { opacity: 1; }
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
    body.light .presence-avatar .ring { border-color: #d4d4d8; }
    body.light .presence-avatar.online .ring { border-color: #22c55e; }
    body.light .presence-avatar .name { color: #71717a; }
    body.light .presence-avatar.online .name { color: #16a34a; }
  </style>
</head>
<body>
  <div class="presence-bar">
    <span class="label">Online</span>
    <div id="presenceIndicators"></div>
  </div>
  <h1>📬 Mailbox</h1>
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
  <button class="theme-toggle" onclick="toggleTheme()" title="Toggle light/dark mode">🌓</button>
  <div id="messages" class="messages"></div>

  <script>
    let eventSource = null;
    let lastId = null;

    // Avatar images (base64 embedded, 64x64 jpg)
    const avatarData = {
      chris: 'data:image/jpeg;base64,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',
      clio: 'data:image/png;base64,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',
      domingo: 'data:image/jpeg;base64,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',
      zumie: 'data:image/png;base64,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'
    }
    const avatarColors = {
      chris: { bg: '#1e3a5f', fg: '#93c5fd' },
      clio: { bg: '#3f1e5f', fg: '#c4b5fd' },
      domingo: { bg: '#1e5f3a', fg: '#86efac' },
      zumie: { bg: '#5f3a1e', fg: '#fcd34d' }
    };

    // Theme toggle
    function toggleTheme() {
      const isLight = document.body.classList.toggle('light');
      localStorage.setItem('theme', isLight ? 'light' : 'dark');
    }
    // Restore theme on load
    if (localStorage.getItem('theme') === 'light') {
      document.body.classList.add('light');
    }

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
        return \`<img class="avatar" src="\${avatarData[name]}" alt="\${name}">\`;
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
        const colors = avatarColors[info.user] || { bg: '#333', fg: '#888' };
        const initial = info.user[0].toUpperCase();
        const pc = getPresenceColor(info);
        const status = info.online ? 'online' : (info.lastSeen ? \`last seen \${Math.round((Date.now() - info.lastSeen) / 60000)}m ago\` : 'offline');
        return \`
          <div class="presence-avatar" title="\${info.user} - \${status}">
            <div class="ring" style="border-color:\${pc.ring};box-shadow:0 0 10px \${pc.shadow}"></div>
            <div class="avatar-placeholder" style="background:\${colors.bg};color:\${colors.fg}">\${initial}</div>
            <span class="name" style="color:\${pc.name}">\${info.user}</span>
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
  <link rel="icon" href="/ui/icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/ui/icon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700&display=swap" rel="stylesheet">
  <title>Mailbox - ${sender}</title>
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
    .presence-bar { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; padding: 10px 14px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); }
    .presence-bar .label { font-size: 0.6875rem; color: var(--muted-foreground); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; flex-shrink: 0; }
    #presenceIndicators { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
    .presence-avatar { position: relative; width: 32px; height: 32px; flex-shrink: 0; margin-bottom: 12px; }
    .presence-avatar img, .presence-avatar .avatar-placeholder { width: 32px; height: 32px; border-radius: 50%; font-size: 12px; }
    .presence-avatar .ring { position: absolute; inset: -3px; border-radius: 50%; border: 2px solid var(--muted); transition: all 0.2s ease; }
    .presence-avatar.online .ring { border-color: #22c55e; box-shadow: 0 0 10px rgba(34,197,94,0.4); }
    .presence-avatar .name { position: absolute; bottom: -12px; left: 50%; transform: translateX(-50%); font-size: 0.5625rem; color: var(--muted-foreground); white-space: nowrap; font-weight: 600; }
    .presence-avatar.online .name { color: #22c55e; }
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
    body.light .presence-avatar .ring { border-color: #d4d4d8; }
    body.light .presence-avatar.online .ring { border-color: #22c55e; }
    body.light .presence-avatar .name { color: #71717a; }
    body.light .presence-avatar.online .name { color: #16a34a; }
  </style>
</head>
<body>
  <div class="presence-bar">
    <span class="label">Online</span>
    <div id="presenceIndicators"></div>
  </div>
  <h1>📬 Mailbox - ${sender}</h1>
  
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
  <button class="theme-toggle" onclick="toggleTheme()" title="Toggle light/dark mode">🌓</button>
  <div id="messages" class="messages"></div>

  <script>
    const MAILBOX_KEY = '${key}';
    let eventSource = null;
    let lastId = null;
    let selectedMessage = null;
    let replyToId = null;
    const CURRENT_SENDER = '${sender}';

    const avatarData = {
      chris: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wgARCACAAIADASIAAhEBAxEB/8QAGwAAAQUBAQAAAAAAAAAAAAAAAAECAwQFBgf/xAAZAQEAAwEBAAAAAAAAAAAAAAAAAQIDBAX/2gAMAwEAAhADEAAAAfHQKSAAAAAAAAAAADFRbwKigo8QsXKXzEvRFRs8d6RioICDlRQc1w6VnS0vq9L01rzfVwuT9Cx638Vi6Ln/AE/IhZIzTNgAqooPa4l7TivV+fqr3rkvP3ZMMddHKY/QYfVw1o7lTXnYipMKqKK5jiX0vzTosd+pV83N6ODtZFC1IcV0e/I6nYivlVR7L5KAK51yFfTfoU0k1uYpZdG5zyXZrRS07XDKkvVZhKb2TUtQTpsyUWmqZ8cT6ZjpNh1VMW5h6Y3o4o7ZyxMSRXlRCAQAAAAAAAAAAAD/xAApEAACAgEDAgUEAwAAAAAAAAABAgADBAUREhMhEBQgMDEVIjJQIyRB/9oACAEBAAEFAv0+0295E3i17LusYCbQj2lmHoFttWNogrH07GC6ho9UdWrsMPsCaDR1Muj8THPa/wCNZVRYYfWIJpdFtdZyhUmPm3k2akwazNLLq1i2eB9Y8NKTlhFAJRQOfSXzVuH02zKAbFXlLKyo9jT7uOH5tjf9RtWJmE2c62TNt++oS/8AEISPUJh2fxYaY9puFMfGVp5jpU3WlpVLiNkPZgR6lBMx67FmNfGZbBlZHFdyYR2+5QTvKvm348VRmiVKIBvMNl85mUWY9gybFUc2jJ08b/F7RlQxqhGBXxqUTlFnPaYrf3bFFq24dUXGRTlP1MiP2hMMJhEX53m83nKEzB1CplsyqJmZo40kLOtGsBG83h/Rf//EACERAAICAgIBBQAAAAAAAAAAAAECABEDEiAhMAQTIjFB/9oACAEDAQE/AfGEMK8sa7NUGJRDjUj6mVdWrj6VdmgxNcPuXM6ttCK4YH1MXaruFyp+UL7vMlbcEHcGUp0YzF++VwlT3Hf8Hk//xAAgEQACAQQCAwEAAAAAAAAAAAABAgADERIgITEQIjBB/9oACAECAQE/AfmWEDbO2K3hqsYHYHuU2yW+tdrCGoMep6ESkRjAb6VVuJ63mIPUVcVg60Y8TDLkQDHjyPFpaAEcRV/T9P/EAC0QAAEDAgMFCAMBAAAAAAAAAAEAAhEDIRIxQRAgIjBxEzJQUVJhgZEjM2Jy/9oACAEBAAY/AvF5Inor0/lW5lhJQe+oGk6LjqY1HZNRNI4U6m/McsOizb7of8cvGyrDXRku9UB9V1EY/bVEGkZGhK4qRHQpmEzflsHlkuLtW9ChUgiBwp4fF73WJstH+pTdM5jZPJp4SiDJwo8RPVfkM38liDQqvSNhU8jO7dE4uaJnEF32fSntBhHp1TaYvqiPeUVGqiFfesJRqekTCtkpMFFrVZTyMlxGV5BMpaOlqIblooUlX7ztuQVir7ZO5RP97JKlRo3fvughRVcGO91+5n2sNIyi5yyWXgv/xAAlEAEAAgEDBQACAwEAAAAAAAABABEhMUFRECBhcYFQsTCRodH/2gAIAQEAAT8h/AW91dSokzMy2W8y3ntIEsa1LKj8olhQheXniPQJ3kCBWrDATNJaxpB56lS3tfI20bobEOCnzB0PcQSyQ5UNCLEq1x5XN06K6j/AXmeCW1dQVqOgVy+ldo0QVClJJhCciy5HkE3I9LHsOgmVjE+iXlAdgSbIkC59vmX2RdCN3HbdDLfWAioYoTpHuIQqD5PMC6tgNiUlZq6jCAZQjGRLTYH2wlW6qWsvFygKj2EOigpoHymqko7MHZXyW/7Eb6hhX1KqbKr1cuyqb/cbG6o0yyTLDtIzTLxCzCrltTeVuVL/ACZcgYrFwm9XxFtJ0yxf3QXUYd46yxgm4h19mnUOWJ36u0cUVxhDVipD2S53m8R9fP6m56lMilo9byqEoKUmt+ybi+xSh1AV+iPxEGdXmYLddpUt2SyvpiLBXSYl0znaYW3ALY7D8m5FLimUQQ957Sw4Y2q2PaKRsraJaZzsXmLcLF8R8mhLYZf7idnHZYla1iOYsxyfgf/aAAwDAQACAAMAAAAQ/wD/AP8A/wD/AP8Ag8taO1o0os3li/Joo07hT4xIoMX+JGpoQ7CcWV4D8BGAf34z/wD/AP8A/wD/AP8A/8QAIREBAAIABgIDAAAAAAAAAAAAAQARICExQWHwMFEQgeH/2gAIAQMBAT8Q8aIpiUjvNPJXmLeHAKcTTXveIAs8u8RV01/IypwM6S2vr7m/kIfRcORfyCwajHKpYLQmjZEbuLAlwqj6gooSbUslxz8P/8QAHhEAAwEAAgIDAAAAAAAAAAAAAAERIRAxIDBBUWH/2gAIAQIBAT8Q9EJwkIfEJypjHZMqEInicsV0IpmikL4EdPCUahohhyC1gXDaQ+oNdAnDtn4VSCQbNERoZiX2EfCc9P8A/8QAJhABAAICAQQCAQUBAAAAAAAAAQARITFBEFFhgXGxoVCRwdHh8f/aAAgBAQABPxD9AO4wXuwXvC5nvAWF+ilajKEfJi9zHuM8ieZ0IahBcvikI8IHaOQE/eGZewKX3xA2gc35O4/x1BIkroQIQdK+CgItVwVC4YJjlxiFCBwqfcXECZW0VvESyn9TAX7+x4mCCDo9SHoWNvY6HiAUQdzjsVGniXIjxKnA4HNNn3BiHoYwhCGUqBmjaq0sV5o1ZOKpFl3p4p8XA5FlBcGrcOpTFgInssYkxCxDXesMKo0FhMbHJDiDPUYQ6jxDMuAnWDf5IyADLn8cn4lGNayUcvBbFdj5xk6tOhcifPPuV1ZppgVVOvUIMUqhRwn5alIG6hOW1J0MehqHTrKAKgI6StSiaBLYfbB6uQEKPAH7XAKbtw2n14j06rs470Rh6X3gW33UdOaVDQBXBgdKN1bCijsj0Ojeay82zIwB5+P5jOCq9tBb8ZccxAA0hGt3WSlePEfKi0oW9q9RsyIVr/AnJkg20oPR9wmBcWiC3qLkbmvMcUgsehCbzwQwXB0NikkpjVDcNh1Gb9D94P5g1F3TzVEWToLa7w8w/CKNfARRd3j/AFE/G5GSXa5jGBjli4A++lwhg+pz/YEQuwT+zDL8KkvqJJH9pt+0gQNt04fLyalMVkS3NO0SZgceWCBDl22XzRUUKsuyOnAazxxEW69mH8R1pvGROeDSaeooSuzjz8zSicMsx9K9uPiBZr0B3h62ob5zDgDwdkilAUePfeZq08l+EFa7TwLwfBM5WCDb42+z+YVA3Mt0TF9jLvcdMNtoZp5gQMOYh2KhfOe4AouM5hGNqLY0ysjPGLg6z2laK7hi2p/7HMAuW1teZopPkISWOnswYCIy8IFKyQiC/H6D/9k=',
      clio: 'data:image/png;base64,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',
      domingo: 'data:image/jpeg;base64,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',
      zumie: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAByF0lEQVR42p39d5Rl133fiX52OOGmil2dI9BAIxNgThJISgwiKZmyZcum5FlvZMvjsSXLy+M145k3Xsthxmk5zpOfLCeNrJFkSVQiRUmURIkUM0ESIJHYBNAAGp27ct10ztnh/bH3Offc6gbl9SAVu7u6uures3/7F7/f70989hP/2Dvv8N5gTIm1Fc47POABgQAUHo/34c9CSZSUCCFQUiKlRCmB1hqtE7RKUFIjpUJKhZIKIRVCSKQARP3dw8/1vsK7CucN3lvwNrwG7/DO4Z3HOo9zDmfAWo8xHms93tevQaGkQEmFUjJ+KLRUKB1fo5QIJZBCIIRAxvcgBAghEVLM/owg/j+Edw/e47B472avz3u89zh8/H14Z+FfhX8thEAgw88QIv4aPwg/s/7Pe/Dhf8IZeBE+Setr4v9473E+PAdnLcY6jLUYEz5KY6jih7EWay3WObwHJTxKCnSWLwAO5yuMKSirMWVV4KwNbwiJEBbrwTsPQiCtA8JDxTu8FwgvsQ6k9VgceIv3Eu8lzgVDEGL2gMPhu3D4vsK5Knyv+gE7F38F7xzOeZwDawTOgrEeZ8JzER4EHi9E8/DqU/AiHEQ4UBE+EU48fEl92Pj6/2eP2YcvJ16H2cEHA3XO4ak/53GeaCitw0cgpEQIH4wficCFHxxuFNFKIDzexhDCv/e1+c1MwDevKLzf5mt88718fNY0z1w0F9Dh4t+BTrNu+AbOoFSKVBKEpyin8YY58DI8IhF+lPMeXDhEkABYAG+it1B4r1Fe450EKZCutvr6Xbh42028+eHPvnWzwqGHg3fO42w4fBs/nI23Wfn4sIhvEBTz/4UDqW+baB6naA55drW8ByH87O/DuwbvcDicszg38wTO+2gM0QPE7xlut0R4j1LgnEBK8CgE9eG3X0DrPyEaL1BbhG97CWi8j29/HbOfG7yixylQCAQWJwXOCQQeITxa6yR8c6mQUiKlB4IrrqgwzuGdRSBRMtwa0dwK8Bic9wgXbpmwBosOJuEtTkiEE1gh6nsY33g4aLAtV1r/npkBeI+zBCOwRAMQwTgdeOHrC42X9auKB+zl7Gdyi0VELyBm3iK6+drYZ/4g3PT6NVpn46+u8QTBEJg7jPrWKakQAqQUeB/vtPDBCJDx9/Xr9vOvNx5w2zvV3qEJFU3oie9HgBQCJxRKBa+jhMKK+NpleM4Cj9YqiW/OIp0HkeJ8jnNFcOPWY2O8Rghk/fKaOB5cm5ASIYMPc74Ca/HSxDgn5x98/bBbrnX2+/pNz2Jcc/gObMsbeOfxMoQdJxzOBxcvkCAkUsjooVQ0CDHzBPE1eS/iZWs7fw/etf4U/uy8xRFuv41ewPoQnnz0BL51m8MtjAbqBEIEbxrcSjAC8Agv4u+ZuQ/felb7cgs88WfF59P6c+MDhETK2qgcQvjwOS/xTjWXTWutowEInPMgNB6Nc0lwzSZYrnMuxlQXzl4Ed6uUQElQEqSkueEhznmct+HBxzdVu8h2qtSOvI138bUxzL7Kxc85J3CunQiFg/QOnHNYUyGpsF4TnJ9EeIVDIUUCwmLxCFe/Xj/zE+Gqtg7fNuEp3HSDdQ7rLNZbnHVzbrhJloUI3tQrhHfI5qa68DxEndy5xjhn19zPvbdgYH72tObetw8XoUke6wfZMgAhogGIYADS4p0IBqC0isla/UUOj8JYReIThCS+8VmcE4QYqZRAKUL2HT65z32Fg7I2WKp3xBc9bwSi/lXMkiCBiAYgWkYSPudd/e+Dz6+qAu8kQuQkWU42WCXvLNBdOIpOukilkCpDSI2QGrzB2yK4dlfg7QRnx7hqiHMlzoxx1U54oIImubTeNvHfuGgQrk4G67PzTeJVvynhBF6Er5NC4rxHeg+E0No4/fhefcxOw/v0Icl0vpVgtoyjeR6zMDCX48TQG0J7fREFXgq8c2gp1SzxkQ7pFM4rEq2RwqGdjPEtxmwfEiIp48G3b/6+MqV2VUIIvHEYFyoJ50X4/FzaMjMA0YSYVlLDLGdCSMBTlROkTlhcPcKh4w+wvHYHeWcJnfYRMmky7fqBNS5IzDKDJrsWxMqlwlVDTHGdanKdanqNanKDyoxwPiS9npCDWBcTwhimiImdECKGn3ihhMB5i/AihqnwpRIVv+d8Gdj86mY33MXyrUk0iaGwCQmtHKBJeIlZhsDhQwLa9sQStFJy5ra8wwqBtKB1uP3K21kChKX2y1J4pBRIAVL4JiWsY3jtnoTzoMILtM7hbTAKarcdTXrOAGISM3suovEMUirKssAJydGzr+fEnW9kceUUSmUhLlsTSlgzbeUZrdpKiCazb8f8xsSEQKglsv4B8sH9eF9RlZsUo5cZ7z3PeO8SRbGD84Rw6UQ8nHBD6/LKSxcOxgXPaoVD4EIe0IQbWvmRuK0BuNrFu1bMj8/ZNc9b4JEzfxofXZPfNN9dzio34RFeooWUwQV7j3MSh0NKgdIa4UW4FXgQdbLmwh0QxFKCVl3vozW6cPDOY0V4MMrF0CpDDuFqd+eCexXxkIX0yPgmiLG0fkBSCMpqzOLaGe588AOsrp3FWoepCqwZNa6zXVfX3qJVvsyVTO0bNbsaBiuKJjOXepX+yiH6q6+nKrcYbn+Lna1nGG5dwJgCoRI8svn3klmY802SG56t8DaW0HXIrIv/VjXSxPb4e+cbQ7Dezb9mH0PUXL0zM+b6G4q6YdJ4iPB6tRAxK3UOhAm3WymQHuUlvqmoY8ZaZ5TR4RB/33TKvEO6mJVLB7GXIBVIW9ugD7fQiegN6oIIcAIXDVXWjZtwDFg75eDp13HuoR9AJR2K6bh1sHI+m9/3a7vn0qqoQ+Lb5CBiLpFqvJotsGYKQqDUgKW1t7C89kbGo4vcuPoFNm9+A2vGaJ3PMho/S1Kbmr35v5h0N32C2nsGI2hutpuVwzYmkC7mAk0vABHP1TfVmWinTvX7avcbRF0tCXSoTS2OCu8NQoL0oW1AbAnTSvwguLL64INLq7P2kO06EVydcA4RO4WhH+SbpGRW9oQkRoi64BIIF/MGWScyClNNOHDiEe55+MOYqqIsxgghZ2VSq0PSzh5oJZjtJsrshMUsP2CWSQvaXkE0HsWaElMWCCnJOyc5c/cZDh17G9cufZbNm19HeI/UeavQbXmdOv4LgZ9/EfHrfJPlu3b89y6Eg9j5s97NdRtDH0HODn+uKVR3Qv2tfSYE2nmDd2VoxcZvJESoChCy1Q+PL1N4BLbxAu1+AHX7VoQPK0KvVsbOWttzhNp3f08gWnPdLHWAlFhTkS8c4c77P4QzBucsQqjZLW+9QS9A1CWkmG+oBCuYJZ/O+1kKWoccRLih9ePz4QE32VbdRvaeqhxjKkGeH+fsPX+R3SNv5NKLv8N49yJp2o3GfmtH0nuBkPPhqL6hdZUzM+a6t+BnEcrNm83MXGdeINzw2vPFiyVaeVr0VdraKfiKmE/GL1LNDW8bQN0+DC3d2YE2HSsRDEAIC8LG22Vjshi8R+g2xnzBxhfnwwuUvmWeApwMRuCc5/hd30Wa9CmKUbz5rRvLbbpkTRu3VWf4eVcv6v67DAmqFDL2O/y8UXk/CyExzIiZf6CajjBC0uud5Z4H/ypXX/l9bl79HNIrEOl8XPaxRPQzo5srhn3r7goQrs7h599fO0yJuUvk5mYb7QvSbr7VZq6tnUSjbjuP2URsVpfTcvux9GvKtto62wZgwsAIgXShxFTSY+WssSSFxwkZfvWNCSLrw0HgXUV36Sgra+cw1RQhZzd/roXkubWUmjtsmravbz9IQpIlWpYuhQyHXjdrYiOFOjGLF6OpckTotpXTXZRKOH7qe+n0jnH15d8CXyHIovsXrVlIfcizKkBGo2jNSkPCXidFXiKEQ3qJa49/PLOLWlcjTUCVrQ5hOyCF32vrTLiVrQfQHoe246eg7nDRGI1o/5u6V1A7ei9QMf4r6VEatCN21YK7a6qiVnPIEtw4SExlWDxwF4nuUrTj/i09RI/fbwnRBdQFQTPscTNDkWI233DONV/b9AaliMltay7gZx7F154lHoK1FZPxFksrD5N3DnDpwq/gqj2UypsOXZOht8bDjWeom13RuGxMvENS7OPgzd3SdxF1HtP4fRfyAu+b+y/qdybq8OeRzhm8s7h6ENOchJ+7JqJOCUT79QuErEe9KnTZYrdNSo2q/y7+qpVGKYWM8/owf2+NOOvkx4X62ViPk5rF1TPhjQgxVzOz7/B9+yX7+a5Z2y2IeOtlfYul2F8bNhWFj93PdjtK3jI9bH8EAymm2+SdY5y448+hkj7ex7yF4D5Drz5M7KQIz0eqiJ9Qs983H0K1MASy1RqrLbbVR2jer2uFBd9qsIVSVQjQ1ob4L71ESBmnSLF9eLsxmqi7NjL2mOKLiNWkFKKJQiGbD7ffqtAL0Lrubxuk80gR8Aaza11HPI+3lrS7wGDhCNaZWw58Zs2z8q0ZJhEOT7TxFK2sX4rQpm4OutWZbP5N3YcQ7R5Ba4wrZs1538oX6h58Mdkh7xzl0PH3c+OV3wy3XYYh1exQ1cwLtHoBzSwEG6p0OevoeOlDg8nP34fw0lw43nboavdcfcjdfByRaWtNeFhSIgl9XemDlXrBbIbeMjjRTNSYtVXj14iY4UofJ3XRdSnp8Cocvm7fdGWRTuKEi80mmp62NYblxSPk2QLGlq1ecOw2xg5cAKfM0Ek10gdmXsNH+ELdmAkTRYuxYaBjrEWKaPRStjyOn8snQvXgGk87K/hn00NnLFIqEJJivENv8R6WplfZ23oMJdM4OQ2HL0UsuYVsnqeH8PyaEw+jdV8PeGIbVzg/6+3UFUQMGX7O8meNbyFiMzu2hbWxFRKH8ip813qU6j3ey8Yom9vhZyiTWTyrgR4xnsZkJli8D909GX5oAEZ4tPLBICQ46QNQoV2yIHEelg+cQSqFN6H6CLN4j9Kabp6jpKQoLLt7I3Z2hmxv77G7O2Q4nGCcwVThgLEeqSWdNKE/6LG0NGBpuc9goU+3m5MkGuccpiwpqwprg/uUclZo1bbXVAv1dC/+pXAerxVkGU4IZKLxHux0j8XDb2Y6vIDwI4RIgxeIH6KdFzALUU640AyTwUPJOjcQAoUMn3fz2X7jjVpeT4i60+ojaEY0oVwba1BNOhUGQ+EXH9yFl02nLjRwakyAmMO31TFSAC6WB1KEw5XSI2MV4H0YHaNEQKooj3KygX6FfxSGK0rnLK+ejMMQEMLR63YQQrKxtcdXv/osn//G07zw/Evs3thkZzhka3OPqS+RUlCNDWkicdYysoZ0bDCpJMtT+klG1klYWRywtLDKmdPHuf++s9x91x0cO3aQhYUu3numxZSyMghCuGLf2DV46QBYcFqRXrlB94WXENbAi6/g0xQuv4z47/47+me+k+FLv4tEIoVuDr/GCs6VghFC5qRHehXALtGb1p617i4i2uVwXbn4xuM13lmIGPt9AxPTzroZZqwd55Gx9HEIH0Edog12qP+NigON/bM9QCgkrc5gfFNK+jiJclhl0VYFT6DiGxES7y3d7hL9wUGcqxj0OlgEX3j8Gf7o01/g2Wee5cLla5zYnCJSwcuZQCM5dnqRv/Pesxw90uHv/vKTnD+/g8gk76ngr7x2heeu7/GvtvbYlBXVeMLN9XWOnF7nq898mZ/7RcPa2jJHDh/h7jvO8Mgj9/OaB+/l+KkjCDyj0ThUCu12ckwUTVGi0h7uWy8h/9lPgdBUe0PyU6uYosRd/Vcs/OgP4rs9zKpEliKGgTg5rDukraw+tIptxF4E5BAiAEkcMjxb3By0QrQQQu0pK62pZwh14ZLq0LsPN9uJEG+EC65fOvBNTTw7+KYkQMfSQDYdvNmjaeUG1JlreNEeFaaJQqKkxuswJnXO4aUNM34zpb94gCzt4V3F409+k//7F36Nl186z/r6mFJoHs0W+ZcfPsfjn73Ej28P2d4a88M/eIi3+B3GWxO8L1i/sYHoKt4zlZz7H+7i1O+P+PkX9ri8kuD2Sv7yD5/jb919kJcLyd/+zfNceH6TF15+nq+df4qf/+hvsra6ync88jDvefe7eOS19zMYDCjKKWVRNKNr5zzKCVxl8Tc2GO9MuLK+x8l7TmAtVFOB+dZVkr/1T1jIcqb/26OUrzmEHDtEolrPSczmAvVj9hIvXUQUSWZDX9cCB85ja7yLgVQ0zc8mRMsWVE1I0M3kKVpywKi5MKgREbjgb21eCN8qSbzYd/hN37AZOlDDouNcWkmw0iFlFcCktgQXQk6qO6QLfQ6feA1JqrhxY49XXr7Ge9/+Vt7yt36YS1cKdkeWO5OM6X09Dj26x0+hmBaG5QUYnU5YvzblB7jJ972jYHNvD7MzZOOpCZ/LEtLXr3Fuc5OL4w1yIXDnL3D6zCprK/DEzi7Zcs73Dxb5/l6fXxyN+N3PfJpP/fEfc/z4CR599Dv4nve+gzvvPE5ZFmxvbTMejtnavsmBQ4fpfOHrqG4XTnYYT6ek2YArj19k8Y1nkIXHfOMq3f/zU4h/8yHMkQGysAjdqgBE3S6uPaeIbXMxC7Jezh1+DQ6p8RfhD3XFJhGq1dyLlV4Dif/y5/6xVypg6aUQsf4UAVcvVUT9KJTU4WtkglIaKZJY/8tZjtlyP85bvHNYa3HGYK3BWoezFaYqMFWJdeDJUOkKOl0jzVfQ6QCtu0iVgJDYaoqrKjqdFLxnNByjFUjpmRpDNanQuSKJb8hUjqpw6ETT7econSKlplSSSmqEFWgrmE4NZVmxub7NiTsV29dv8isfeZyLly7x3LXL/NUrQ37wb53jxT+8xA9/6WV2FhRuYplWlqWlVd7xtjfwvne/k0cevIdXLl/kP3z+Z7nn+pS/9PHLvLKxw13vegO7F15mdHObp7/5EnefPM7GxhZZKTjcyRm8926G/+h9+EQhXQtB1LqQNeDUOoczFmtmv9bP09dorQZx5edmHFIG2F7de9E1Z0KGPowW7QxfzGBEs2xEzmeZzSyZ2bCivv8NLKk2gllJ57zD2Sn4hLx3gqR7FJ0dANHDOYktp5hiTDUaMyk3wvjVm4jAcewEBEZo3rR69VIKysIzjXmIiJgFM4XhTg2DcuBc7GsIUAk6zUnSnKNrGcWmYNA/xo/92F04p5mWhvL6NjvDXbK3vsS7F8/ztRdfRMkR//CvnuOLj32Lf/Azv8LHPvqbfPjP/Tn+3Pd/gMHCMnd9+uuIUclzV9c5eGOD/toaTz/5HCZNWFoc8HtXL3DUSHJ5iIWvvkL3Jz/H+H9+J2LqYiXV6i044mCuntzH9q4Xc4OjNizMxQ/fyuV8/Lo6+29XHkLIgAcQc+QB0WKrtMdAM7yZb1xVyw2J/TDlaAzO4ZxBJyt0Fo+j0sNYl1JOxkw2tiknl3BmGuvo2CiRGqkEoJtGSTMcqV9D3W6KdbOqMYOt0YdqD3X9bGSND69pOt5hshenoday4UHpFJ11SHo9Npd66LvewE986FHKKRR+wtHROg/0v8n57QP8wSee4qd/+qf5tY/8Emffew8/7DXewbovOP/4ed74yP3QyxkMIROae9cOsVRKCiW4Op1y+JPn0X/6Iexda6jCzy6W8CB9RGmHP7tmAGdb3n+GNWhzKHycrwcOwqy5NNc9jIag/ocffc/fq+lboR05ixFS1vDimlUSuAPzrcgWe8XPvICzBmsrkvwQ+cJrkOkdFBPN7sZV9tYvUozWcWYSwKU6ReoEmaTIJEUojdQJCI2QEe0iZTOeDoA6yfxMrp7rzxg/tenXRImAlNVIlSB1gkoyZJKishydddFZL/x8PGa8R7W3Trl5ld3Ny5TTdagmbMuc0cpdvOM7vovvef97ecNr30yxOeLJ8+dRHcdrn9vhmdFNukVKb6vi4KE+V7b2kGPH8ZUBrvCMqXjx+jZrKiHp5vjvvBtRmNAivk371ft5bIBvDjsCROLE1Nafb01VRXOWsqHNSTFrNYsnvvTPvYp96Lo/L0Xs5snZPw5GEuK+arUwac+X4gu1tkDpRXTnLiozYLS9TjG8ifdVmAvoNJRAsWaddetcY07NbN652WHG465pY7fMflpUKL9/ZtryZg0Kyvv40GXDJWj8XetnOmexZYGrpviqwHuBTDLy3gLdhRXyzjJbw5JrV69x9He+ysXf+gT5hStUe3scP74Ma12e/cZNDq3kiMLQWczZNBWLssPa8oDk538Ie6iHnBqQgnZi7qyLHUuDrWzg+pWR71eFPMBajzW2MQAf3b3SAq0kWksSrUi0Qica1ZrJiCe/8q+jAdQt1HriJ1rGEJglUuqZF2gaQC2gQ4RIJ90zOHGcvc0NiuEN8BaVZKCSpkE0T3rwsVzxDUuIOFShBlw6G/AEIuAVZcxmfZzuWRsBoRGiTTvTlTJ4GaUjT49wqNZFIKmH2JJtyKHRMGbj2jrQhmrJVVNMNcVWJc570k6f/sIqLKzSNSnJczcY/uFjXP/13+a43+D8pRtMp5J+mnAozcn6GdcVHD50gMH9B3D/y3dBN48ZvGihgSMM3QQjMFVIXsvSUFU2HLx1GOPC+4kJoJJyzgDSRJMmGqU1WquQyEuJeOZrP+mVVE1W2By+mL9R+5MHKWftS4FoWDFp/0HGo4zhxivgS2SSznoFTa3r56ZowRAi8cTZcPguvCGcI0vDi7amYjQas7u1w87mBtsbm4x396imY0xRUE4nOFPRTkyk1iid0OkP0FlO1u2RdrsMVlZYXF1lsLxEr7+AUoGvZ62lMgHqjZCNsYc+evx9CxTi8XhrMMUUV05xVQlJSrK8Rm/1MNlEw+MXkF/4El/8D7/AaPsyAzpcldBxikff9ABLtsL+2HfC9z2C2J2G8FbnTzYwkqyxVKaKBmAoyoqqDAZRtQygRlwrJVFakmqJ1oos1SSJRicarVR4LlKiVRP/4wHPHf4sytft4GbgYd3s8KPF6u4D7G4YJruvoNMMLzsBkiCYueWa6BBbzc7bwECuQ4AHWxm8c3TzDOHhpZdf5tmnn+bKiy8y2lwnMVMy4Ui1IE80WaJItaKXaKQWDanEe481Dl+BHV1nbCw3pyWjwjKqHE5pdGdANlimt7TM8sFDHD91gtOnT7CwvIyQkqosKMsp1jqUTmaDpuhZvBdIlZF0Esh74AyuLHFbG+zcuIzIO2QPHaH7lr/Aw3/2g1z/zU/y2K//GsVzz/P2s8c5cHaN6puXkFrFWYhoKOGNR/KzS1h3bGULhl/T5+sQUCeSAZneTuzljKZe92Ze+MZ/9E2cj29K3Gbk3uTXrVKxHtp4V5H072G412Gyc5kk70bIgozDlBmyxlk7u/GClrsLn7fGoqVEuIovP/Y1fuO3/4AbL77AfYe6nDywwJHlPssLPTpZhk6SaISBgVy/0RmVSsxqAu8xLkz/jHWMi4rRtGRrb8TV9R2ubO5xZXNIJRS9xWUeuP8+zpy9k7N3nubUyaP0FvoY6yiKCk/EM4jQzg3QrVgnyVlV5a3BmRJbjHHWoPuL9A6epC8W8J97ivEv/TL9Z58hSRT+Z34Uf2wFUZpZ1dUmn1qHMYaqrKjKkqKs4oehKi1lZamsa4aSSkqyRJFlijTVZJkmSRK0buUAwQPoKOAgbp0JNADCGQjdiVnPL3SsKnS6wrQYMN29RJJ1cR6k0rS5ul4IrDVxklbP9mWgWcfJmnGePEm4cvky//r/+5/47d//FEcWOvzIux/m4bPHWMgzEinCqFVKvNAgVINNm/UvwLXZ15H+rl1wpcY6ktSSZ4Z+r8vS0iLHxgXXt/eYFCVX1rf5+Mc/Ht6DSlk9eIQ3v+G1vPXNr+Xs2VN0eznGlBQ2PJcZQMTPZd1IEYAx+QDlHa4o2LnwNLtpSvLaIySP/G3KTz5Boi/jTiwhJhVI3QJ0tLp/jdZAG1Mg5gk0kUc4QzXFoU9TxYnZ4Kl+Zq888/O+dmvzbJw2mdHPYrRoY+0F3ht0/wFG2xZvJqAUQoVqwbeycOdsDB0WIWo+QD34cVhj8bbi/Def4//9f/xzXnzpIsfWVvjg6+/mva87y2Ivo5NmIXlRCV5qXJ2519NIIWYusLaCSFixtoqsIUNVVRhjKCtDUZWUlWFSGkpjubG9h/GCl65v8dRL19BasrG9xyvru+R5lztOn+I73vI6Hn3bmzhz5gRaK6bTEuddiK1SIlTEQjY5VUBLSSHxWEw5xZUTRKJJ1o4xWDrMQBXI8iVcuQsiiYbrZuIYUeEjeIGSsvEAFdPCUBSGsnIxofVoFeJ+p6PJs4Q0TYIHaCoAhZASrYRu+sOihc+qGyYzKnJs/NQjxliTCpljSoWt9ppvqrRuABgNfkeEeaaICU6YEelIPBU4a7j8yiX+7v/5L3n54iVOHj7A3YeXePN9J1leWqDbyUjTPGDuZYoXuuYozcpI52d8xMhh9NYivEV5izOhDT2X4UtQWpGmKaWxaK25trXLyYNLgODZi9c4emCZrNPh2vYezzx/nieefob/51c+xkP3neM973wbb37Da1hcGjAtSiBI5ShJeB5CoqQPoNj4Z533IOtgqoLy2iU2b1xlsnSEhdW76Pa2cZOLDbZyHuEv9tX3s4+a/FGjKWrgrhRtkEwLyRu/n5ZSz/RyZlenJXcyY6nWBlBz0b01iDTBG9dApKROYlknG0ClELJpYAgR+nOuhdMzpkLi+ejvfJJvvfgiJw4eIEsUD995nFNHD5J3c7K8Q5J2QXdAprg4hm6AXG5WTUgXxSacBWXAWaS3uFaZW2PzUBIV++pKO1KdoJXixs6QO49oulnCEy9eIU81C52MRClsH4qi5DNffow//uJj3H3nGb73fe/iXY++heWlMC0EQaJD3PXeo2pMonQoAUonpDrF511sMWGyfYlitEFv9SSLyw+gigvYYif2OO3clNW37UHsI9XW834pkEqEOYAUTYIvW9IxAOp//okP/z0lVVPmzawjNkFqanLtiuLU0Nkw6BGqD2IBZ4rQzVM6wqHajNcZ/adu59SsZGcN1pTcuH6D//Czv0hVFiz2clb7HT74toc4fmSNJO2QZDkq7SB1B5GkIFNQCUImwah0HXr0LBFjNnMXbS2gGcQ5xOqYYatIc1ZSkqcapQSdPCRON3aGCCkw1mGNQ0hBlqdkWcr65iaf/dLX+MJjj1OZiuNHDtHJc0xlWp1SMTvCCCypcwSpE4RUWDOlHG8xLSzJ4DSpBldsh3lI0wkMCCcby2TrgtsPg7bIw5Sh/EuTWPppHQd6EYIm62RfoGdoU5pmjMDhXHTZEXDpYldq1oaMpaCp0Mm8JIpo4el96LoghApSM1JS99tcrDOVhIsXL3Hj5joHBl0kntOHljlz/DAqzdE6RSYZQgeOv5cJUuiZ8IRooYBlGCkH/SCJd6a5KQ6Q3iJ9YDz6FrbBSduUttTIJxkeolKKaWX45svXMVl4BoWxQT4H6HZyOh3P5atX+Df/7mf5vU9+lh/6s9/H2974WqqqwlpDmnkUOjwoa4Mbj0JcCIHOOsgkDQOx4Trr0xGLh07T6yWYvRfjEIiWZkBdAooGvCpl4Ba0w4Jk35xHCtqU4dYwqJ1Myogrb7EULMHCrJ+NKJ3HFxN0pw1OiGhU2dZ1iOSMaHV1A0hKSWkdCM3eaAze00kSTFXxwB3HWV5cxAoVPUuK0OHmC5IAP/eqRmTMoV69d0ihQBhEYKLgTexY+CTMWmKpFEQjDFYYpHDBGoWMXko0sfOh00eYTCuev3yTSuuoe0DUUAolbTfP6eeCF196mb//z36Sd7/zbfzID/1pDh48QFGUpGGijRYS6RxeKmyNUPYeITVJp081HWGrMdtXnsOunabfuwOz+1yY9vmZbpJ3bVJIOOAwshdz7n6GOpZzQB0PaNEGGsxTGWe4+kaXJ/amm6aDwNgpqZ2ErN9UuJhl1uVjwNyLKDEkGyo4EbaNFEgSet0eS70O1nk6Wcrdp4+h0wznQOro7lWCF0mgWwk9A6LIOgfxkeWjENJHQ45YMyTCCkQ9YZQJ0tlAWRYVUlZ4a8AYnBPoxM88WSdDCMEDp4+wO5piNnYobZDCEghKawOi2gW41qDbwXrP7/7+p/nmcxf4n378R3jgnruYliXdjo5CTqph9taTSuctUkqSvEeFx1UFezdexK+dotu7g3LrW/Ecoieo752vVUBEQ3aRrZJetAU4Wodfqym16sx5+H8zinIebx3ezmJ/MAQCinayg06y4G6dmQM5NiG3gVrLFrEkDJmctxxYXebk4TXKsiRLE1YWF2ZTQZ0hkhxUHsNAjPuxf9FWlgifqxMehVAaoTXoDK87OJnhZQ66g9RdVNJBpR1U0kHoDKlTlNIgAtxNa02iFN0s4eTaIvedPMjaYo9BnsS2vSDVQQFDNgV4wD4eWFng2tVr/O//8F/yx597DGct06LAGoNtdBjbvATR6P2knQVUkuO9ZW/9Zcamj+ocxBrTzPhde0bWQL7a5JEZEznigaOWgGwSaLmfQEtb3KCZf3iso2k32qjWZW0QlRjt3AghQyh8NW3m0ULVHTo5SzziwdcxRycJQgoWFxdY7HeRQGVdOPgkg6SH112c6oDOQgiox8KCFvulniB6hLNggwJpPVTyUoYkMQ3GVHnFsPRsTyy7U89uCUZmJJ04Ep5jNClSndDPM+49cYizR1ZZ6uXkica6UCmlOlQ3Skgq69BS4q1lodfBlyX/9F//e/74s1+knI6ZFgWmqqjKgIwydY/CmIYQYp0jyfugEpw17N28iEuOIHTwkkFmp4UQbCmg4dvAnVm50GA6ohEQshLR4pbN06h8m67lZ4iTWq4tWKugGI3Y27nO4uJRqmKIK8ck3SWss7N8Q4g5EQOitYfmTYBwLS4tg7OUxuKlQmUDnOwiVIJSgRTq7Uw+FuHmVLWalrOPdDdncCbkK5OiZHN3xPXNba6vb3FjY5vReERZlEjh6KSapYUeZ08c4vBSlyRN47x9poHkvWJx0OWek4fZnRSUVdAKHJcWJUGrIAClkJTG0s00RWXpdnLGkyn//md/mQMHVrjnrrtAeDqyA0KjnMQ4EzqyKghL4gVOSZJOl+leia0mjHZ2yPsnsKNnsF4ERRfvsF5gvYhgUFocDTGnHxgJYYHvIYPwh/ZRrWO/XMps/C4aYSRfi7/VHHUnwvhRKLbWL5PlAzKdY4phKNlU2ihthTAgmqma9TNsutIJebdLaR2l9WjryAcLjCvY2N1A65RECnKtyBONVBrvok5AW4OweW0VtiopJhO2d/a4cPkaL1y5wdX1TXaHY/YmBaNpSVmW5KlmuZcz6KRs72zx/Esvs9jvc+bYAc4dXyNJEpwNrzORAlfBwZUFzp04RFEZpqWhciXTqkJLQaIkiQDjoKgsmVYUxjDodRgO9/jNj/8Byz+0wMryIloJZN5thmEhL7LU9B9vAwEm63QpJyPK0RZp9ygi6WPKXRw0h28sjVCVjPkFMzWGqDEgI04qkIC8AM1t4F21+oSvx7hSBVy/DBIuRDk5J3xzwM5U3Lj2IkeP34OSCWayQzY4FHh+dVdLzsQPpFC46MKFCDSqrc0trAho5Jdv7vHEZ57hyrV1BAIlJIvdjDOHVzl+aIVDKwssLiyg0yx6F9XwCZ01lNMxN26u89zFK5y/eI3NvT0qY8gzzaDb58DSIouDPsuLfZYXF8jzDG8duzu73Li5zvX1baT3nDt5CJ0kOK+QtiKNzKCTh1cpKsN4WrJXbOG8prIGbx1KCJQU0VVDqhWlMQz6Hb71ref4+tef5PWve4g8z1FSI1IfRLkETeu9zqGck6EELibYylBOJqh8Gbu3g3WCygkqA1VUUVUxvNY3Ptx62fzeI5tBnfega7k2cRtd3VooAikQSiAilbxu7Ahfc/wtQgmKyYQbNy5y+PAdYKaUow3S3oFG1LhRq/C09DoVSjiKyZiapZSkOb/7mcdJpKCqKrZ2hmgh2NKCS1evsNjrcNfxNR65+wxHjhxGZ51gSC7Qs60pmIyH7A6HVNaw2EvpZ4tkWcJyv8uxgyusLi+T5r3QnpVqJrp8YJlzp49TViV7wyHCG5SOEk9SRFStY9HD6UOrbAwnXNoeMh1aEh1a25VzSMLXWu/IVABgWDymKHjq6W9y7u47GAwWSLIMpVUgv8a2vI+YiVBBhXJRJQm2MthijOx0KJ0MnAMrKK3AWtlMAl3Udgqc4KjdjGz0IGkMI/ICbsWfxXghgnIocjaFEtIG7R/hECp4AuEFwlmkzhju7nBDXuLg2nGoJlTjTdLuchRGcg3v3vng+JwL8bOaFqRJcEh5nvPutzzM3adPMhqO2NraZWtri82NDTZ2dijKit3RiFdu3GRpcZGe1PH2CJwzmLKkMhVawMGFLmv9FAUkWtLNu+SdLtIJqumUSggUcXbgoiKaVGgpWV0cYL3FmgJrA2YPp1BR/WRp0GNteYGVhR7DacmkNIFupVQgnXpC69j5Bliklea55y7w/HMXOLi2FuDxaUZg+8WLBU0YEDKMs1WSIRjhTAEupXI6ysILjBVYF3EDvjYAMX/wjSEo8PHzQSMokg6b1q2clzir5+01tVkqnLQIgiBUrTcnnEH4wIrd3d7Aec/htWNQTjFym6Sz1NCVXLwhvpac8QKlNP1BH4egmE555KH76GUdRolmbXmRqjzEcGeb7Y0bTEYjKudIkpRiMiLLEnSSxSQxKHh6Y8kUiESiZIaKPANjLDc3ttkZF+wVFcYacgnLecLBpQWyPENojVQSUwUOY2ihCvAKXEhQhQCTZ6wOeqz0u9zYGlIZH/oDUpIqHTT6RTC8mpKutKIsDU888TT33ns33V4veB/n8DLI7tdiT6KRkZPMaMGhEVQ5FdrSVmCdbAQfagk+52RMEmUYmnkVpqfoCPWXOEB7F8icdVPFt+XI65KiIRM6hLRIFVlpkY9ed55CfhB0gIa7O1zBc+TAYWQxpnCGpLPSNCOkBGMcWmkcgiRJ6XS6ZGnK9u6Q7e0dOisSV07Z3txibziishalMhaXMzAVripx5RRvqlgiytbOgBAUvbU4NEmqGU8KXrp6g2dfuc6lzT3Wd4dYG3T7DvRy7jm6zBvvPsXBtWVUGspT4cKh6Tjp9CLIvgo83RxWBl0Weh06acKkNBGl6xBKkSYa6xzT0tDNkoZRrJTkpZcvcfHly5w4dYqqKgMBx0XxiLoz49uU/FlO7pynigdv4lQ2KJBKpKoTw7irwcfD9yp0TpHBA8Rup7aRkNtWkGoyRydawAKJkK5RbhLShTgVVcRDvigQ3uIiuXS4t8cl5zi8eoickspuoPNFpNZNmSFivawlLAz6DHp9tvZ2qUxFsb3O57/wFb7x0jWev3SDwlqWFwYcXezw8B3HOLzYoxBFmLYlOtTMvhai0ggElbEoJG4y5dL1mzxx4Qr942dZW/LcuPAyk52bTHZvsjstuLq7y8605I13HefAUp9ut0PeyRqApZRB3i5QJzWZh0G3w9pin16esjueIhOFlnUu4BuAqrGOREmMtaRKUhnDpUtXmE4m6FRjnUXagGGsm0NNCd2qwYWQFJXBeokjtKStVxFiV0PhVMwBVPgadJye6sgAV41OoWwzSlyUZnG1Ije1UKSKyBs9E1yWdbcswQuFE/FrZE3mUEiVUkxLrm7cYK+0CFthRuuYYhLr1SCZYk1FnqecOnmcfi9nZWGAR/DFJ5/lp37rj/nsU+c5fd/d3PWGt3F5ovn0i7v8i1/9A564cJkSxWhaoLKUpDcg6S6gsjwkdg5MbJsOxxOee+4lHnjwEf7KX/sxjh8+gNu+AtM9uoniLQ8/yInVRV64epPzl9e5uT1mXFikSkkj/EwphdJBwkUnmkRr+nnOUq/L6kKfXqrppprVXofDS32yRHF4ocfZtSUSGd+r81TWkWrF9vYO29vbeGdRNcrJxdRLyMjRkM2kEO8RKmFcWhAREyHC4XoRPpBJxEvEtjkJXqR4meJl/H2tCI9EO1e7d7+PASTn68fIVmmI6t42VOWgu+7wwtdiWNQ1n5QS6zzrO1sUvT5LeQaTTWzVQeX9MD4WIJOEO++8g4Nrq1y6eo0kTbi0M8XYig+9/Y382b/+Y3zua0/z8te/htSGK5MRv/+VJ3n4Na/BRFeX9pZwcowcByk5oTUy7dDr9/jmE1/HWsHpg2tc+9YzrPQXSZxncWGBQ8uLHOlIzp67k16ecGBlkQMrSwz6HbqdDK1EQ5UPsTwomvgkTAIHecbqoMt4qc+kqEgTjXGw1O3w+jMHWRn0+MzTL/HK1h6J1lSmQinBZDJhMp427d92GzskfyKiizzVJLwnq1JKU6CSDOcFUVgl4BSFR+kAyFE6CfwLnTYtbqGTMI8RM9CsNr4+atHs3cHLeSMQorXExs92s8Q1KjToGhUMwqvW6hLRLJgaTSdU3rPY6ZC7AjOeInQHREKW91haXePE8eO8cvUqvU7Gu97wIF2dMNrc5dkvPsbiYAXvJWZvizOHDrK8uMyw8hw+shLykaQDhYU4K9BpTjcZ0F1c4NSdd3Pf64+QKMH2S8+zZMb8pe9/P9aW5NKRKEu/kzJYGNDrdiN8KhBl5Rw2wjYqp0ppssyxstClm2lWFnqkWmGNZW9ccKif08OTas2ZIwe4vjMErXHeURhDliaxJxIS4jr6i+gtIOAFzGQHUxQkvRXGPkFKS5JmcSZQq5kFoInWKnir+CF1Eo0gjZ5bzvIL50IO4GWEGYuWMHtUCw3JQpR2lTR6dUQxIlGza5SMlcF+Bc849InEE+ssO8WEqpPT0wm4gqoa40WOknD61HGuXr9CnndYvfMwqrPE88+/zPULz+FQfO+jbyJNFb1ej0G3w9JCF4RGpnkod1xwQVJJsjwDUkSac8fdd1OORpTjEYmuWFwI4hZVAdYYkjyj1x/Q7S2Q5p2Q9OFbLCEHzgQdhSgSIX0o6xb7XdIkIU00dx5dZWd7SGoqdJIwrhz5ZMo9Jw7xyo11ruxNSHTASx48uEq31yfLumDdjPfoiM8rwRUjxpvXUEkPmy9jSsjSNOof1grqAqxBiYBC0qlqDr8G6Yi4xQ2pmrxCINC1aJiPM2MvWmogtYBRLRjpiaihqAPsHFZCIkPWK+NsAOfnl0DUmDQlGppZ6SzOKbppjyQxTHe3kWaHbup5+KF76C4s471ieaHPg6eW2Bs49oYTqqKgtA7lCzq6R95bJNGg027IW4zB2zhWTVKETEPsTjKqokSoBGdt3Dji0XmXTrZMt9ej0+2T5l1U1DEQzuK9iZrJYeZfw9drZVShBN1ORi9PGGYJB1cWODjo8KIzCJ1RloZyOuWuleM8cOYIN566gFSafifn0OHD9Pt9dJI2GMAGsqYSTDlivH4RoTvo5aNMyUgSg1WznUZSBPFNXFiblyg5QwFpjdK11Jxs1D1Fs2lNomdxp61Xo+bQtqEzJRqRohqrrr3DurjJywmcl6EfiZspWNdcg5Y2XjPKFRLjDV5KVL/PcipZvHqNfNAj7y4y2RuGbF5laK3odnLKJKEjE5JOj87SATqDAQkGmXajSwzTQaV0UNVUGiEhy3O6veN4Y8NI1ZnQg9DBUEKtH1XOvInbqQw4EeYOlkbfJLTNTQNEyrOEhV6HaWlY6XfppYJrN7ZwKExpSJRgZWXAnSeO8oVvvUJpHadPHef4saOhHazTiMoGlaSApBxuMN2+RtJZID9wCiM7aOuQiQ4QhtjK0cJjVXDnKgJCdJOsxueuaiGvCI7xs7Je1+PYhvYlZQBURKhUvYhANpsmfNTlk3FRkoiqnzF3qNUrGkw6Mw0cWVPEVBzp6lqrFePBZyl3PHgf21dv4m2AU+usR2f1OOnCwThHrwKGT2eoNAvwLpUh8wHWND4RoTO0tyFR8h6sRWVdZK6aRofAxZFvVEr1hIaWLcM2NBeWZIhm11/QLqpZNj7qG2qtWVtawDvPIE/ZHU+oSsuBpZzVXs7xYwfo5zmT0mCdZ3XQ5dxdZzi4doBetxPQu5G3aIoJxd4NvC3pHzhGsngEg0Y6FyenEb+IRguHlYGSjotikFHYY8YIrvmdrX1MciYbo5M0aZEiI5BDtqTLWnPmGuXjo+hCnYS4OIoUscPU0LKbDzmTlWtIpaohXnokaSKZTicMel36Rw7hrEXqHI9FywyVuqhmWgOXw8OX3qLyLkJnYKZx6KRBJ+AVKs5za+iAFJGK3pJ/E61aO4hrWQRVM1Z1+5RT53b+RfnX5YUBOhJXv/y18xxb7PLG191H4RXl7pDEOJ6/fJPRpOChu89w9s6zpFlOp9cDayimI2w5wpsp3cEi/QN3IvJFKgsqVh7eh3mEdxInfGiiqYgMqUOTmKGAaVjetVT/jMVSd2F1kqi5hYozNI+cEzKeocREa7mBm3UOXU38FLW8Rez6RVBII4YoGyCmj+gVF7eMdjt9RmadNMtjt1CB0ggRoGiNApatooKWR2qBzPLIO6iFrEMuExJX1ewzxJbgU6TIEHHwIqK+X1AjcY3MROCUtPgRrh6AtRp08WcJETQLe3nKaLTHuWNrPHDPaXSSMNyZ0EsStoqSL59/kW6acnBtjSOHD+FMyXTnZlha5SsWVg8xOHCatLeMQ2GtJVGt7qyPgzhXL30KmAGcmm0NaxF2G56nDJI6QbffUUsg431YGzenHiFaxtBS3Lhl1UqsPevdP6FCaEY9DT49iEPV31fOKVT4SFJ0XgVcvhJ0uzlmt4rDbYEQScxHZVwZWoUsXyiEqALkK8mDkKSzITtXCi8Cgim8DgdUoXdhLV5WDQ9CtESUva9X3rbURFxNCa+1lF0zOQwhM6igpmmKUmDLgnvvvROdheldL9GsLA74+d/4A/bGY+44cghvKjYuP8fi0gAWDrJ4aI3e0kGSzgJCpoBAYVFazO8irvcDufrX0PP3zjXG0SymaPgfgZRSU//qmY+LpaNWLZiwaO+eqaVL2a9rv2/zhm+rZs8aSmJfWSn2K023FydFhquQgjzvUlUGP/SgRCN6I2yEeUWlULBhNqFzhEzjurd6s2TMPxxhIXZVoqUgFwKSFJwO+xBjpy1g7iuwBdgSb8swX3BRotVbPDNB7WY7mJQoAVJ7kjRBCE+W59iigkSQakm/3+HXv/B1/vCrT3HiwDKDTGOnIw4eWuDsax4g6x9C6U4gzjoLrmjEt+q5vhDMCVTWtx8pmu6t96KlD+jngZ3CxVDsA8ajERb2YWXMzCeIOXYJ+4kULT9Qu2Oi8LDws7Wrbbtp5OaF36c97+eII/UWMucFMlEh1tkKb+N+IetwVRUMwFnwJZUpyBcPhO1ddhotP7ShPYKqMhjjMQZ2x0M64wnLBwyiv4RIOnitg/aOD/wGbwq8qcKHMzhX/zwThRpM4/trnT3hQ4xW3uNNhZKapJOgUsXaQs6nn3yOn/7opzi40OfwyoCH7jmJt46L55/j7gfOhuabreIYWUehKNsY2Lz4np0JQ4uZsIYUvtklRNRpCGViXNohZlpDoglzIQnWYt/B0hJIrgOAbytN+rZS9z5ZctH6PPMsY9F4Jj///WIt6+PiAIFH6igzVxbR/YK3FkyFLUtcNWG6exO1dIjBYJlqWASPpTVCJ8gkQ7oKlTqSbgquQjjL+sYmVVWyujyks3gAkXXjFDN8b2ciMNMZnK1mEvq1F/BuxuwRgSIejD9oLVfFmNSNWVgckCrJY996iX/0C79LJ01Y7Hc5eHCJ737/W3npuZd57skLfPNzX+S+t0ny5WPB9fsSKfU827l+dj4YoNZJzFXCoQvpGoFoF72TFzN1tnqZRSDJyn3exKP3LxNqa6vPtmoL5rcRtbPi+vDdPEK3rVbcWl1U7yWagVFrtQ0729Kto2cxZWAi2UDydGWJHe9R7G0yGm1z6O6HcZNdMBbhDYICzAhf7uLtlDRLUWmOdwm9jubaaJf1aYKOO/3y/gAVJ5M+6hnWkLKwIj7uTKzX4Nbt2pj81TN6KRVSh9f+qSee4drOmBt7Ez73zMsYYzl9aJVuJ6MoDJ/+o6/gqhIpHcONda6f/warJ/cYHD6FTPuAiQlqZON4jzUVzlWkaRYWUXoHwsbcxuGFRQiLjPuaRL3xtL1I0om417mW1Qn9HB2Ih9zCQp0PAH7/eo6WSJlrVquLuBW7QeqKeXGmGVx5tg5utgY1agI6j8OCSvDOYKsSjMMZg5lOKEc7jLY38FmC8obq5ku40mCrCltMmO5uUox38bYkyTPSvIvwnnJvk/FoxOLBwzilGO5ugC1IO71Q0zvfQLOdM7NN5tI3gss1HmCW2IbGEMqjZcKoqPgPf/gEL13bppcl9PKMAwtdFroZiVZUleXGzS2OHepw4MAKC8sdMEPWn/861WidpdP3IdN+pLv5uXlAlmbxc1W8NRYwoSHlbUBCR4Px7eqslerS0m50MZnV3pt9K9bmSZ1+/8r1/etZvJu5mDoGMb+rz4uZzHxjBK1lB2H1agVCxXWoBlIVNoCWE7yJMK/pmOl4l0kxotNZZnztZXZvXiPNc4QxlKM9xuMhO3tDrm9sMZpMWex1WBr0KArLYGGZA6tLIbs2MB7tYm2JTsK+P2cCj8/H9fC+jve1KEPd0axbqnJGfUuU4trWLuNJycHFPuBJlCJLNIkSSByJVnzwA2/krodOMR1W+KpA+BJhDZOdDcxojzTJGvU0KTVKZ1FrwczrNVDTgwzemxiuYtu62WTuo3xPfdFEg8+s2dnaO9PaKRcz+mbXgL/9VqaZYNucB5hhyfclju3M8JZFbzQCDjWS1boKocMtsFWBK6eYYko1GTMZboL0ZN0uzhiE7jDa20X6ivHONtOq5MbmDtPC0u8t4BCMJrCycpCl1VWUThBx47nFM56M0UUR4rknGF29OieWn5LQWfNtAWwxA8sEBVPJ1ZtbVFXgGAghyFMdCDRekGgV85uEbLCIkAVS9MAb8u6AnSsvY8Y79A6djAsiahn4kIA2RZMP1PfQm6gPvWr2Hof1P2628HtG7ppjIXmCEWhnp9zuP4+/zZr3/Xv+fHP4jRHs31932x0/+8tJ38i2CaGxzuDsHrpzALtVYcsxZTFmOt7DmIK02w+ih1mPxe4KxXiPYrhJYiyjzU36vZy1A8vknT5JmqPTFKXzQC5VYZJZGR9JI56yGKPwaK0jo3n/BvDWNoRWKevqjWFxre6Vm9tIKUgTNbe5NexNhk6eB/JIWYAvQotdJziZ0z9yitHVy9jJDjLL4rqbWAq6enVvLRcbAbYu3n4XP+LvbTQCGyX2XLPLmZkHiL9qaye3HEbj4lvuvPYM9S2vyxBq2fK2IbR21InWIkP25RWe+VXotgrQaOcNZTFikC4hs5xyso21JcYUJFkGUS5FJhnojESqRi9H6pxl5yKzVyOSDJEEOrmII15XFUFYGkFZGSSEnbyualQ8moVYdQNL1s2ulnxuvGlSKqbTKZdvboWv92EuX79h6zyjqaGTZSwuJFTFMFQ1QqKzDs6V8WdUmOkWqV5p1tbNGreu2ctcX7aw9NNgXdU6/CDM7WojaAzAt0Q/Zoov2lTj+RvfLFFyjbXM/t7PLSisDaBeKt3+td0xY05PdD6F9A27WwRJt6h6XUwnyGydhYXDFKONZqex1AnDnSGZVKHfH/WIEMskIqWjBw31PEjSgEgShNKxsxemlUG42lBUU7y19HvdMK5WMi6M1rNmhpjn19WrXEMOEEggu9Mp6zvDACKJ7dtenoaJXAx5R44s0F9MQ2LrHUiNtSVKQFWMkVrifYWpJs0coibtNLyFqBsU4nyFdWX0ABXWmaAo2niBGjAaF3U17n/WVNJFudfagFbHDDcnWT5zG25ePAp/m0NvJyGztert/MC31rzVLCRBWBtjjUUIjZmWGHuNhf5x0k4POxmSuPDUK2spqwmdbkJRgp+UuK09RFGRJmkASo4nVLu74banGpFpnPRY56jKCaPdDa7cXOdbL1/m4MqAt7/pNVHbR2KMaVQ8Zsui6sO3yEjebJZey5ThpKAoK7JUR34gAR6uNVpKHrj7KG94w2ksFkqDSjSuLCicDexlZ1E6C9VQNQ61vRSzVbgtpZVQotY3vmo+jA233zgX+AxtKfkmF5hfd6Mnk51ZQjOn9+8a6/EtS2obRV1yuHZcatyNa9ae1/9urkLYt9rUNX1uh3QaiWRY3WAlXafXXcROh6GN6UFoxeNf/gqXXr7JHYMlpjc3KfYmAcegNKYyjEZDympKVRWURYHBhU1bqWTkHbt5l88++Sxu6vjB73kbOgngT28twrrmNdbbvxpjd0TU8ww/qZ1je3cPqQSdLKEygRRbWUuWKO6/8wjv+a776S93KMuwQt7icKWD8YSkmwZ6vVKU5QRpqoY93QRk71rP2OFw8wfvLFX81dQSMi3372Fuq3ljAMPxMHaHagv3cyvLrZ9pA9m4qm1WYvgYi2ZZZS3S2KhZxz6/2ycN21qPEQkNM2XrzGsQjsJPuCwvcO/Ka1F5n0wEls3CyjL9mzt8/vNf4RM3t3jXB97B8QfvZHp9neLGBqO9XYz0ZIdXSXsJvcVFZCoZ7m6xcmCZP/7sV9nbGPIdd9zD/Q/fy6GDvYiJgNLaljT9jNUcppA+ztVdA5lHaYwp2R2OEECqBVkSoOTLgx5vuO8Ub3nTWRZWe0HIsahQQoTyzTqq0YROHPEK5Zs2L/sIe67xpi5yMhyVqahscPvGBskaY208/Iix8C318FYnt05w9d5wHIc2LTWQ6Cqsd7GMCa6zkSNt3ep6U6aLzYdaP6gtKuXa+wNa9PO61dlwBaUgUylo4qZNzc2ta5xcGJJ3Fym8R1hLp9vl3L13cde9r+WbX3iSbm+Vtbe8Hes82sN4/SrOOfKDh6iMYzKaMLx6hUvPXSPZ3eOEWaK/1uXEw2fprOZob5FUGGNjySWa/oX3YcDk4xZxWW9REzMZ+6qaMi2DRFymFXmWcuTACm9+6A7uPHOAXj+lnBbILLB5wqKLgC8yBkajElnYIO+iVJOQ232bon1cEuW8aw67MpbKho9aBdV4G6H9t+4X3r/YS+8Oi7mVrLMtFFEMwvuWMET0DO3Y4n1LtMi3lMTmvYGf24ZZz59mG0CkECRSoxTsygmZ1nTSBFF5rm1f4uyBe4P2gDOkWYrO+4juKq9/dIny4jp7v/15qqUB+dGDlEXJ3s42/fUR4xtbjF+5QWrhnFtFFIrVI6dQx/vkq3mM0ZpqWjbyN7JekuJdxA66hgXtlYrbTQNwRtowOHO1QLNIWeh2eONDp3noNSfwhNs4LT3KBsSO957KlEGqFYLcnrLzwpIITPSutfydo76U4SxqAyijAVjrMLH8c83F9PM7oEV7q5tA7w3NnHZeLT3i4s2vQ0G9jSL8ObyIOsGrBYvrg29+P7c2Zr6dLMM0EyUVSdTddU4wNpYsSci1RnhNplKGwx22B9v0sw7TcgpCBdm4bg97sEdWacR2iVmfYtevIq1FmxJtJ+SVYa13GKthXO4wrUYkax3yA1mEUeuoakLrYc/m/408PC7uDQyJqBMCqRWmrEiyDnmWcGRlgTzLuPvkYe664zAyUdiIk3RAVVl8ZcN+IyRVFRrx0vqwMs/VgBYfgKlCYLynMCY2dXyjz2Sdw1jXeIC263fRY7t2sV1PZ+VsMbgA9GQ6U/OucQGuduV+xhJqewbnZCum799oMdOXmS1Y9M1+htnAsea/Q1nr28sAaMx1hpYpmcpIlUKjublznXwpCkfZgMxReEQ/xyRThJ+SrixhpSRxHm8MrqiopmNGww1GOzv4jic/tkS+3A+1upJh8udMa9l0WP3qXVBcqAWbw/giAi9iK9h5E+p9IVjod7nn1GE6ec7xowcCHdz4oF8Yl0tqIbE4JkUg0aZK4b2lKhyF8BjjIiNIkCofSzmiEEQcCLe8sbH1B03H0TqBbdBDs5prbul3a6mGtjYLgyIp5uBf9Q2e01Wsxwpx/+xs37NvxchZk0G2Nng3syFm8b9eYSoEpFFnN1GaTCd0kpxUJ6Raksig+7dZjFlNO+jKRP3BCkGCPLJMufUc7tpNjBMYF7ADVVFQVGPKxKBXe3TWllB5jisNSZqG8OOq1kLo1tKKmlgaASii3qsowFShl5ClSdwAKljs9Th1ZIVeN6e32EXohMrW5BlBVQU1FYdAyoSicIyiAmg3tplr3cPCQCk8mVaU1gcyboz7ztVS8iruVZCxBFethlyNzWhB81uHT0stTCM6s521reaDbKZGoFqdXUlrTencuvZ2s6j953kFqtkS45mGXQgFQVAhVZo8TcmSNDBctEQJidQJZeXYU5J+lkfZ+WhwaYq88xCT9BUmNzepihKrHVaDyCRpfxGdx2maMegsRye6deC+tYm9vYgpxFVfQ9yUppwWOFuRZdlMXVVKBoMuUq2QpykqzcKSZAGVt4wqg/Eh059aF5dZacoI5Z6KoJFUD5akqHX+JVqBic2xdqvdxBzAej3Xhhd4lPANb2Au9je3f4bW0kp2moOvqdttvSVZbwSjRhOLfapivrWZys8NeJpvUrNd20PnllWGBxkaJ3mSkKUpKlENIVPKQMiUQjC1oNIeXTMO2AKtkFaidEa6skAlHXY6wVUW5UHrBK0CGUXHjWA6zWK27bDetLJjF2EOLhy+sUEYQnhQislkjDMVWZ7NhJpj1t7r97DSYi2BtOlCEpfIhMU8Y1gaJsaRxnLLIejqWsfQBli6AOuDzKuMUD1nXZCbIbKxHVTOYrzDiyQs5o6MUhG1HhqZf+H3GUGLeBK9sFaq01KapAX/bolFtaFcbSPwt5kU3zpVmm/8COZWmQtEUw1oJUmSBJUmJHG5kZASqeXcnt0pEpUt0PFVEJpUCbozIK0M3qakeSjpagEqqRVKh5sqZSy1vMVWEUmkBL50QbfYVZiqwpYVxpRhq4mA8WSCNYY8S1GN5J1sqFm600U7RzmeYn0gvjhgZDypF3TSlF4GpYPK+iAiFWN3fUG0Dtm/lwLT7FmYwb3qqswLHQVNPcK5eFF9i97v56FkYgbNEGJeE1JL3WkBOGfCgg30e7Z4dk6tQNyyUXa/3KS4jVn4JhcQrUZL3QOob1TgtAU1sFp2vb3uFAFjqdAqJQt0GkRngFAd9CAie/zM94Wk0wTsXRyb2nLS9NddlIGpTIEpK0xZ4MoKj6OwltF0greOPE+ROizPElFgQYiwmTNJUzLfZ1K6wM8XCuc9pfcUlSdxEi1FWJxN3M2swmYv66K0DRIrwuoYGctkrUNO461HKddoIQY9AJDSNStm5gZ3+3CcYh9Os/6NViqfrw3n94XMdcXamPP5s58fm86MRMyyPz+/WbgdTGb69qG0kkrF3X5qdtviToNAKwj/coQikUHjB50gSUCL5jYE/kiEeldlhCw6XBlWuTgbPkwxpZxOKMuCqijCqhfnGBdTRpMpUogQ25VG1STLehN3NEolIM16OFGSaI2JKpyKoIskpYiqaJCkgtQLlINpVAXRuLjKVWJaMdgGagNSxq0q3jcdPhWrNe/9XB62H99Vo7SEuNVPa6Wzpi68FRrW6huJ9kbw+c/NskoamfZXiwV+Lhls/7sQDpWUUfq9tchSzgSQg0iobHKQsRcsMIuBwvuGJOK9Q2IDttCWgMWVBXYyxExHGFthq4JiMmQyHmPKEmcNRVkynEyoKhN27WndfAQZ2TaBpn57ljwb0OktRG1kh7WhNRySaR/cNoLKCxIFHUA6T+FVSNziZVIITFwFHxBS8cAlZEAac4iQCLo51pK/XTBuNDpvBfU0BiDE7WK52LdXuGUIDXK1dYvn1ru2EUVi317x+XFAO0YpOdvyiVBBkEmJmf5vG77uofJQiIqsGuN9gjeB2OlcRMxUQYYVHLYqMMUe1WSXqpxibRlW2I7HVFVJVRmGkwnTInRH64UPaZKgdYJSyVzcn7Xrw/KMXGvS7iJFUcY+g6e0sUsoAzLECYESgWlolWSgPNoGrR+8w0XyjIwtYyHrPcEeG1dHtJ21ljNlT78Pbj8nEO1nM4Y2EFgnSdZaADlrGDeaEC333+QKLXlyWsazf+nUbcHEYu41tubtsSKgzgVE8AJKxs3XUQq9FptusVVKkSHLEWK6h/caW0yxVYWrqoCDtybIsVUTymJIVUywtqAspkzGU4qyZFqWTKZlAEmosKcw0WHZYprm6DRpQpFSavbSYxfUO4fyhn5vmUoEIor2nqRe5ug9yrtIww9qPV5KpFb0BbO9QMhm/WudOAcW3nxf378KzkqIdpXVEgJvQ/Hr/VCA7vb63waw1SKNiflwIMT8Crlm4+j+WnO/ATXsO78v2rSkzZttLoHdqqLAhJLh9sy53jjBrJKjiOIFqpsvYa1oBlI4hyknlMWYqgzbPo2tKMuS0XjCtCipTCCdKqWb9epJdPlJkoRKQqjoBWQDFm3Wt0RUiysnLCwdwKVLAS4mRUsJPIaoerVOrPOtmM1pRXPzmE1m5/iYrfA5A1ntI+OIWw5/rohrnZ0QAj3od+fLNXH7TEDMj5Lm2scyMoADu0c2hiBrnZvbLSLcN6USrbS13bCQst0wmrfmOg1XtZbeyQcRnQF7LzzJeOs6xoa2rimnQUHUh85eUVZMJwXGhmpBR11AGQUidYz7tbiC0mH1iqx3BLb27rQ1fl05JTFTlhdWMcx4+HXC4iJGr7mNaka/CwLYNopstZZy+zbLwnPbTE3sr8SYC+sI0QL6z19ePejlt8n+92UKYn55ZPuQ6nZu2E5Fs6miXkB9+20E81Wiv13qWZeH+7qUYv70Zw+gtv7TD9A/fnfY+v3S01STPUwxphxtU4xHTEdjNJAnCU5rXEtCXSmF1vWWbRWqEKUDZStKxElZr1wTzT7EZgpqDXa6R7bkyHqLwQPVSzYbgqlvqgda285Eoz4y2yDubwvWf/VUfa4k9/N1/62eIG4N63c7tHs93t+ugr81gWtuZfv3Uuxr8Yq5snBWltxqabOf6+eqilmlsK+2EC3OQTvIeI/Ie2SHTiEmm1AuU06HDNdBi6CSp1UgaTSNFT+rYHRU2JBJEku+6PJjJdKs2I2Jahvn4KzFTIckk23S3gI677TGDL4ZLNVLJeejoMA6E4mhgld5/LfP8l8tdNexQtxSuDfPWHc72YwNNvcDX/0HzVxUay+tbCeB++KQmA9WYl9Luf3z/HzT8RbjYV/JKm7ZrRdIlcYVgekTu30666HSCboyOAdCmDBSjYMvGdXMwrZtHfX0a7GM+L5iNYJs79+bHYz1Dl8VlLs3Ud0F8v7i3D6DGijbrOdFzC3plF5Hz8BcPJ5jaP3Jvddb2bm3CeH1X+o0SZmj6fDte7pzDl20av9W0jcnONH6urkXVTNYPdxaKN7q5MQ+A2pd/1v/kxJRyZZBKJI0x+Y9vA3zfKkrjHGoGvtXj6QjNmGmjjYjaorWAkYhxFwN24zEraEa7ZCMNjDTNdLeIIJtAyeyho23iTj70/db+ii3QHr87cPmqyYI/pZsrr5oWtc73/aHZnE7u/CtGn+fN2jdCDG30XC2pezVrdLvuw+3e1PtbqNvPIjwt9JV0iyn2t2MJMogoCC1DpwCHxTNtKmwlaWKM38B6Nh4qgep1tVSN7IxANHSOqrX4jk/W/5krceVBdXuNpPkEkKdJu32yFRAC1fGxNUG+5prc+xscftO+qtdRP8qEWP//fD7b5JAq3rJs9j/+L+dV7h1fNx+K/PF6K3JiLjdWxK392xzkan1NWJfwuKiCHOqE65dvYjduY6UClsT+GQSqOPaBIXsIPUYPEKMy0FVSzWwNyVdM1Nodu7ROnxko5OEFzgb4nieJFSTCWJ3A5IOKj3B7nCPLM9ZXFhmMpnGhFK8Woyda3btj5a1txRe3HrstzhFcashtZyCbmej3/Y/v/+bi7mO1JxnEGJ/cXqL5/gTPdWtSclt/ioqg0tBJ00Y7+7xa5/4ZRaZ8Lp7H6KM27GCOFKCkClCVUjnwpJu4dAqtIy1UlHEOiiFYWxUQ6PRBPCAUKoBhAYJXdUsbRJxr5E1Hi9KqskQdtcpun2ubm7xc//113j3d72Td7/j0QgKKWZAnOa05S3J7i2P3MsZ4+o2z+lPLBVqRRhACyVv6dqJfSXhq1L8xG1T8rl4L/ZPCtvom1f5Xrd4CCFuI08QQA9CSIQreOLxp/mZ//pfeeD0Md7xtjeEOb53zQjZSRBJirAVwsUtPdIjXehdKK3jaN4iTA2uka3w21pNF/ODRvQKRWVs2DKq86CXaD2mLGC8x3D9OkcWD7B1fYt/8s9+iiefPs+HPvBezp49izWxbd3SUJhvy7dap17MP+5bSmsxT8m+bUCNJxxnD9pLcftiT7QSWLGv4bC/T1gP/eS+qaC4XdiYs7TbXnqxTxhlXqegFjkSCO/w0+v88sf/kP/0c7/Be77jdfzw9/8ZNq9diBSwllv0AYoldRbJliouzgrSbk0d7gkrcKSKspDtgxAtfYDQC/BSU0VxCSETdBra2A6Jtx4zHtNfMHz0Yx/jiW88y8Jggd/97U/z5FPf4t3f/TY+9IEP0sk7OGfmBm23eNvb5LzidvWBELfvDe+/aVFjWItv4/7rRoxvoUr8bW6o2BcOuM3h3/Jj5Fy6OAcXb/MUaUnVCiHjxK8CP4LyBr/88T/gp/7jJzm6mvAjP/jn2R1ux40kzDc1av1DpVFJhlQ2brmNfH8CPjDsGo7CkC0BLd9av+pjH8AjKMsSgSXrLKB0Elf1ha9xTjLodfijz32Rf/Xvf4myCkonWZ5y4XnD57uf4fvecRKfPISQnUaEci74t/Oe/W5Y7KuSvH9Vt+9fJa7rVz15z23E4XiVQW+r2SBeJYFome8MJOrn89rYUQzSK/WwpwRnMeWE0WiHyXibna0bXL95k6+fv8wffuZF9rau88E/84Nkacruxo0Zg7lVjXjvZkrc0sfNmaGFLKPKuTdu5lbnlEBC77te+SqFDNr7VYE1FZ3BSsgfYhJp8Sip6eQ5v/HpL/N//dzHMMbT7XQw1rC3Oca5TY4ftLjxReh0MeoMab4Qad5+bqjWjtt/cu3H7fzmq6Z1+rbf9TYt2pm79u2G8G16+7P4Ml/o3Tq9aLyJF4HtYiqm0xHbu9tcv7nBlWs32drcYDoec+PmNhubW2zvDBmOCoxVWOsZ7m5wcCnjkQceYjIa4spJOGylw61VgrYKjmgbWK3EJaPGcZu4UnsGoRpjCIag8D5AypK8i0p7qETHRpHCIsizjNIYfvKXPs4v/c7nUFKRZSkOz42NPe6/+wD/9H96A8VkzPWXn6PfzbEKNkYHWF05EtbUG9N0C8Ws9JnXcRK3OaTb6DncvqL09eLIdjL5bQ7X71P1mJNMFbdwz279we1kppYItkGNy0ww1Yhyus10ss10uEWxvcloY51XLlzn/IWbrG9M8Iggy54G3R9bTVm/cZV3vfYOFpaWMbWolLM4Fbt5UVwhiFDFWy11s1VVqnDAvrTN9DB8DRH/r5rdicEINNVkNyxoSAdoLRsJVicUg16PFy9f41/+l1/lS19/joV+LwhXesdoUvC97zrOP/wbb2RtMcG5JYyTjK88Qdq/BMlZvn7tIqdO3svK0jKmKnHWh9H4LaXY/szc/wktvHbPfXZeeiby2PK64tbJk7hNj6D+d6IlALEfCCpaNV7om8f9wd4gzBBpdpFuSCImdLMCmVnkUo97j6fwmlVccZLt3REbOxOmlWBl5SAf+YNv8au/8wyYknJvk9NH3o6QMmD4ZVzqjAilHyEj98KBdI3HoV4NL1UzpPE24utqoUYZyjwhFF6GbVveFKgkJ8kXmiWNDkiyjCxN+MTnv8JP/j8f5cbGNoNeL0wQvWc0Mbz37Yf5x3/zERa7ISlN0pREJXT6C7hyzJp5HN05xjef2eDAofs4fuwknTzHmYLKGKSSbRW/ZvbxKrO7W+c5t9F40rcydVuAA3G7rpyfrw/FLZH8VtW5JomUpHoM1U0wQ7Cj+DEFXwTVK1dCROdYp5AyYXFhwNLKQWTaYWtzl68+dQnpPMPRkMUMjh85Gjh9QiBUAk7gRN3YMbNtnHHFPBGESj14cWXkU0QlTanCbiSl46bN4C6U8Bg0WW8hAE2iK17o97mxvct//i+/xkc/+XmkUPR7vVjeGZx3ZIngq09t8b4f/T2OH+pz+tgCh9cGnDi8wJGDfVZXl1lZHnBgcZc3n5JsTJ5m9+oVnt1KuevsvQwWVnBuSlVWjbq7/7Z52W3Oa39ZH3KAb/NP/XwaKF5lXHyLgexv1BDAFpOdS/zfH/lFrl25Cs5RlAXGVHhvSZRnkMPJQxkP3rXKnSeW6QwGkKYhZssEEsXPfexrfOOpKyz2corJiIfPnOLEqTtCvJciaAc70cC9sWXQ1JM0+/h8q60b6O1lBFeGUa9XGqlTnAxbtrRSTLauQ9Kl01uK419BJ8+QEj7x+cf4jx/5XV65ss6g10MIwWRaUVmHoCBJwzaR8dQzKSTr20MePz/Gcx2hJN1ul4VBl4NrK6ytLXNoucvBlZxEGv7wixdwMuUHf+D7+MD7vouFxdWgcVROGvyjv1219yeGhHgRxqNt/+0bgeLbNej3IYrna3of15JYB7nf5D/8zH/in/zkJ8nTtAkJNuL3KhPw+FI4VpZSzp1Z4uFzBzh94gALC32E7nJ53fKR33majZu7CCmwow3+8oe+m/f8qR8g62RI4XCmwNog+CRxQf61HOOtbeb+DaZfOKhKzHiPcjLCWhduv0rwMrh9U0yDdrDMUEmONSVZktDJM85fvMTP/Nrv8AeffxydpCz0ulhr2d6rOLiSsrKk2dw1VEaEHUYqCUijJCHLUjrdDgdWFzl14hAnjq1hTMWN9R2uXh+yvjlhd1TS76YYW7Gzt8PB1RW+461v4IPveycPvOb+wGa2Zm5+IG7j8v2rGYAPI/JX6fruQ4mK23eUZjXdvPP3zqOkZDKdcv3yk5zIr7F18wXuPZOxtTNlc7ekKIP+gAQSKeh0FALJeOR47MltHnt6jyR5hbyTkWdZjMElxlRY6+goxck776I7WAAfNP6tMei0F6SPTRHFKeSsD1BvSIm8wIbKFmHoQiaNoLKb7OCqEpEuBI4CjoV+l0s3bvKRX/08v/XpL7O7N2EwWEAC27sTrPV86LtP87/+lXs4upqyvl2yO3YUJgNyPBKd5XTyDt1uztJCQie1JNLExRkHGBeaGxtjXr4y5dK6YHMIw1Kxszvii489wUd+/ff5/u95Fz/xN/4inYWVRtdwNnr3r+oA/L6cQUzG2/72xcJ/w3xgrtnUJpYEKrWtSv7FT/8MR7uX+O8/9EbK7csMxyOurQ955fouV26OeOX6kBcvD3nu5T0uXRlTlp5ES7IsIUlTtE6QEZihtWA6mVIaE+HTFX/3x36Etz/6zjBrN1NsOSXtLmOLIbaYBGQwgXUr4qLoZimzKbDTMaYq44JzGcUqLWa0hbVBh1ArRa+Ts76zx8c+8xgf+f3Pcvn6JoNeDx1Xwe4Np9x3R5e/8eG7+YHvOYOzlrJyJLpONsOORSnD+rZA7HRU1mGrugGlkLqP0ilplsLCCuTHocyxk01cucXO1gafe2KHo2sDzt11jGzpDlx+JoamQGcTUrRswO9zCPOJvOY2gIr/pqGCv93h15QvSVlM+Lf/6Wf52Z/9TX78h+7Hmx28MCwt9lg5sMh9958IX+8srii4dmOLJ565zh8/fp0nX9hhY8fiEOgEupkgTyU3NwvKsgxbxrViVBQ88eyzvOWtb8cHqa3Qyq0m2MkIU5ZB6FGHbVkoHQygIYWGSkHqIBXrhcBVU+x0CLpD1s3DMqjxiF/8vc/wy7/3WS5e3SDPEpYGA4w1FFODxPE3f/he/te/dIZs4GAyhiQh7SQzL+kcuBJrKqqpw3pwXgdMogCtUpAKKQPPfzjt8sQ3thjoF7jzWEVlNTrts9DL+FPvPxH2GZkhlM9AZ5cXzncYrN7N2upCFLkSc8LebQ/QbrTr25/7fL/+trg0sa+/z0wUMU8Fv/uJ3+YXf/HjZBrOnhggxBRvJ5Re462OtXYEV1jPoQN93v+uAe//rnMMJ56dsaSowvKjLNEMBpr/+PNf4J//zJN087BqVUnJJ7/4Vd7zru/innvuZbQbWDxOykgPs83ETqgA6gxNn5rOLsM+PRH2DJvRFlVRoLvLDBaXMM7xyS8/zs/+6sd54tkXSBNNv9fBWktRlXhnsaYiSxM+9/V1/uL/vkknhdUFzdpyTqeT0slT8J5p4dgZllzfmLKxUzGcWKZloHp1skCITZIAOxssHeTCpRGqvM7f//HX0R/cEbaBWs/GdsnzT36Lp751k4tXR6Az7rnnFHefO8crlzd55HVvp9vNwmq7dvPOzys01oagxW1m0k3XUdyKy/l2WHRfN/nLS5x/8guMhwWDgUSYEVtXr9DrKNJcg1Yg0qDzXxaUVUVpDVQSkWjyzoD+Qg4qDa6rKhCJ5d1vWuPf/bKMKlhBUuXqjR3+Pz/zc/xvP/4/strVFNNp1MQlysfrQDWLfD5qqTU8QgZqtbWW6d4mEsHykTM4IfjiN57hFz76e3z2K99ACMHiQh/vLKaqAnvYGKy1CCkprecrT1+PStwiUMrrslQIlKr3MIaeiVYisp1BxQ1qCInWCZ1uhxsbT/PBNy3wH//p96NX1njhqVf44ldf5HNP3OD8xQnXt6ZMSh9WyqQp3U9f5e6zV3nn2x7g7KlVFs88xKQIG1gaeblbysFoBMV0z9+K1fOvGhDEvpbBPNZM4sodsvJr/MIv/hZ/9998iV4nIU0F/bzg9NEOd59a4szxZQ6tDjiwlHPsQMrqchqMwicY38GJLO4sDiHCuxLvKtLU8tf//qf4zU9dYdANUzgpBEVZce6Ok/z4n/8g99x9D/1Bn6oqcT5sBatpZiKGHCL9O+BCLFoEQaqxETz2xDf4jd/7NJ957OuUlaHf7aJ12BY2GhVYYwATOAoRLRwIohEuVjfL/WymOVPkCPgCYyLQpN5J6mBxMODUqUNcvPgyP/SBU/yPH349n/7SJT72Rxf52vktrm+McUA3z+j1c7IsQRJwjJ1uF61TvMy4754T/K2//mFOnj5HURSRx+hv5Q3WamFlMfyTYabi25SVYn5YIPa+gS6/xcsvvMSf/9sfY3tXYG3FcDTGeoGKJVSiBUo5Di5KHj434NHXHeKR+49y6OAqeacHOo0/N2THWAeJ5uuPP8/3/8Tv4XyKlD5O/gSTsuKDb78fI3Le9uY38dC5uzh4YJlungX516ZM8ownU5RwFJMhW9vbvHR1g68++wJf+uqTPPnNb1EUFb1eN/w77xgXFWVhuONYB+cdeyPLpLBMCkNVBeaPFDG8+DYTNyCllZJoLclTTZ6ndFJJogVLCx0OrS1y7uxRvvNNJ7j36Jhf/9jXeXFd8skvXee5izskSUInT+jkKUL4KFgRWtJSJS3sjSdNElTa4fWve4R/9g/+Jt1+h6qycTUtrSFZS7CjLIatdR6eFiXhVRz+q7UWFG66idz5DJhttCj4p//uU/zbX3qRRIRyTCUJSZKR6CQkUEXJtKyojCfraA6vdTh+aMDBlR6DXkKmPYOe5tBqzonDPc4cW+SO00t85Lee4W//i682uYePCd0HHn2I3/vs4wwLy4kjhzh1/DAnjx7m4OoyiwsD8ixjOJ1y7x1HOH/+PH/0xad45epNLl+7yWRakCaaLMsDk9dZJtOCvb0pp4/2+IkPn+VPv/s4QibsjQxbexUbOxWbuyW7Q8N4YpmUYK0gTQLDKM8Ei4OUfjel30tZGqT0ezn9PEErTydP6Q56qDwHNvmZf/+H/P3//DKbe45OnpBnCq0CacU6mBYBpdTNJCcOL3DP2SPccWqNlaWMTIMXit2x5JkLW9x1z+v463/lwxhbtXo5bQp5TAjLcuRfLa43zd19DeZbNCN86KJtXf4CC/YZtPRI6bn8ylX+8j/4fZ59fpPA31GkaUZlBWVRkShPmoYNl4iwAdy6kJFb7wNaxrsQN7VnZVFz3x0LvPaeVX7t91/mwuURaRJcb2ks733bAzx5/iJX13eRQFlFoYg4XbPO873vfj3FZMSnvnQeIXTD/lUR92+dZTQpmU5KDi4pfuj9J/nRP3snJ47mTCc+Ckj76PKZYQYiVgChwwBJ6qA4Yi04iUNgDWGSKDVSpQgBZTkmUyW/9fEn+Mv/5BmkTki1iNvUoCgdlYO1lR6vv/8Q3/mGEzxybpkzxxKWF3sknQVQOmxTkykkCxi6PP7MDfqrj3Dm7DlMWTZooRmVPJ6uqcb+//8IIBq9n2Ja8Zu/8X/x/odSBv0ca6YIIbh+7QqXrm6xV6QY0SVJcq5eu8mnH3uRL31jnesbJSDJ0oQsKoPIxmBdRNoGEkdVRbdrDJ1MxoWIYRo3KQ3vfON93NzY5ZkXr9LNgmZwoiWj8YR+v8/7Hn2IFy5c5CtPX6LbyaM0nY2wLMukqFDCc++ZRb7vXSf5M999hNPHUsqpYzytIvNJBTCpIEwPo/BTiPkz7IBs1uMGJXOtgm4wSQIOxmPP1u4Y5cfcuHKZH/w7X2FzmtLLFMZ6huMKKQQP3LXK977jFO/9jqOcO7NC0knwlaWYFlTlNOQVMkfofpxcJsikQ6ebMXZH8d2HI6VuJjjd7gno/5Za39+2DSyav1NKsb11hV/66Nc4t3wnj9x/HGsNSmccPbzI0cM9yNcgOwDOQLnGX3jfcS5c2uOzj1/ni0+t8+LlMZvbFaOxYTQN+ncuUqa0BK0FiRZopXBeh7ZtTbQQAu8sWzsjFgY5ZTElUYFXuL1TcMeZk7z3Xa/l9/7gc3zzwnUWBl2MKWercG1Q237dPYv84Pec4N1vP8nJY6uYylJMx2jpWBpkM3FDqeLDphkfz2H8a8UvB9PSs7dbcmNjysVrE755YYdnX9zmhUu7bO5WCAzFZMLmWJMoz9ZuQZ6nvO877uCH3n8Hb3/dKosDqIoJ5WSTyThiD4SOM4kKITxKhB3LAo8tJwyLHNUBmZ/EybWwVGLfcM77/QYg9uX+QvyJSWAwDsXzL17g+edu8gu/bXjw7CJSaLw3lJG3Dyq4w3IDZ3YReO48tczZuw7z//oBxXDk2Ngt2dqZcmNzyCvXdrlwcYsXXtnh+YvbXLk2ZFo4EiXJMk2iAxgzDHHCwsgbG9vce8dhnK3ApWxuD3n4wbt49K0P8su/+gmu3dyl38spp9MZz0GGBEnplOtblp/+1Uv8219+hSxN6HcS+h1FLwOlPIOuZnGQ0O9ldDNNr6PQkUhiLJSVYTwxbO5WbO2WbO6UbO8ZtvYMmzsFe+OKsrKR9w+JBlOVKJVQVQZnJd/z9lP86J+9l7e/bpVEGSbjKbs7QbRSeIPzE2SSkSaOtKPxXlKVFePRFoVJ8D7oLA2WUrKsoLBXmIqVMAn18/iOeQMQ+3uB4k/0DC2CNpsbV1DC8LFPvcLbH17gT737QUwVZV9UDzFYAWFwtqQwQVByWjqoDEprOt0epwYLnDohwpBGWHAGO5lyY2OPp55b5wtfv85Xn77Jcy/vsrlTYKxHa0mqIM9SdoajkGVnKVu7Q97+5gc4d3qN//xffp3SSnrdDGNsA4oQMkz66hW51zZKrC2a8k0KGRZZNEqpvmmwNPS3urMofKsEDORPrWTMMULWvzgIa+KNMTgPpioYTgvSTPP215/kJz58D9/52gWUhvF4i2l0vYFOpsiShESF5PSlV8Y8f3HKU8/v8tzFXa7enLA9rPAeet2M08dXefNrT/DBDyyxeBSmU9+wq+ckYm5x92JukH/rnPG2JIOSlWyKxzKZGH7qV57jTQ8cY9BRWFPgE8OFly8w3LvJXUcVh9cGoFO8kVQuwSOpjKGqDAG/VW8hCx+HD/Q4cmTAu99xB2ZcceHyLl//1jpffvIajz+zwUtXdtndrdgdTtgdFawsDnjk4Xs5vNblF37zM2iZ0cuTIOKg9ByILQhU+diRUzN105oCL28Vz6innM1VaUgj4bCMCRrDYWm5ZVqVTFoEGFNVJHGu8foHjvNjP/Qg73/0BJ3UMByOcYWJq2Icifb0uznTwvHs87v80Zdv8Mdfvc4zL+6ytWcojY9JrAjMZqVR2vD0C1v84ZevUGT38+E/X6BUEiDvjRhIzF2rctTe6vgqdOR9wlEtV+K8JFVDPveJn+VH/5dfiJ0ywb13LoCrcB46g1VeujJiY3ObY2spb7p/kUffcIhH7jvGkYMrqE43CCt6AcZiqyrgBNwM20+znAmSRAaar60Y7ZVcujHluZe2+NI3rpENDvHggw/xX//rR/jcE1fxQge6lqUBW7ZFrWfukObvfEt4yYvgCdqMJ+H3y12FyafWik6WsjjIWehpFnqafichy4LaGbhAXDWOrz97hfe//Rh/72+8iUxMGE2rWEEEpfROLpDe8cqVMZ/84jV++7M3+Nr5bW5uTxESsrRWHZMz0aooXSOl4u67z/Loo9/JYGGZ+++9i+986xuZjEeRgt4y6bIc3g5wfFuf3+4n190C6yWpeYUL3/g4f+5v/AKbGxPSRFIZT1kZut0uyytrTCd7TCYTytIxLS1JKjh2sMPZUwvceWKRk0f6nDjS58ShHscO9lhYzEJ30IKvghhyQNj4KLYQdP21gEQ7SDLsyocYTsZcv/Qy4zIlH3+J6XSPvYmjKg0mulTrPMZYKhO098rKYaqgvmmNY1KUVMZTVY6i8kymNtLJRVT6jlxCLchSTb+bsDTocPzQIkcO9jiy1mWhK8iTijSJtHnqjqZHqITLl26w0Evo9FLKKnghD/S6Cuk9X392g1/6nUv89ueu8sKlsNSjk2u0igYcDbGGtat6VbwKzaizZ8/yznc+ytqBNZaXV/jg+74b72q9pJZMfzHd8/8NkgO3wZWFuOedx+9+jax8nn/x05/gX/6XbzDIg5RKURrSziJpkjMa7yGwUQQq8OmMJRxCbFBo7enmkiMHcs6d7vPwuVUevPsAZ08tcXC1C1kEeZaGqnSx5+7AlzinGR76EV65epVBkrCUO7KrP8PSsUPxPbngZZrt5r6ZCzS+WYp5jmRd/riG+RIVyJjtS6z1bIRuFlcHD1Y2UrPN1zmLtwXOFTijyAdLVMUUoRJ6vRS85Qtfu8rPffRFfvcLN1jfKci0J01m616ahVax6qiiYLS1PvIVQn5SFCX9fo8f+2t/maXFRb7zra/jofvPMZ2WzbgYPNo7923poM2G8Ntw06WUjHY3kDsXSHLPX/uBuzj/wnV+/Q+vkGjN4cM9/sKHHuLGjU2+9MSUi5cLitKTakWWKtJEkWUhiaq3jVSl5/mXJzzz/B6//vtXyHPJ4QM5d5/u85pzKzx49wpnTw44ttYn76fhwVoNDja2vsqlpx7njuwidjUlWVlhNAqYwDB5NJHMScwzzEzStlltO4PCxWFBI7s6x3qut3W3mMo110HEfYoi9gq8r+IiyCQMoIodHDnGazrdjETBV59a56d/5Tl+6zNX2B2VdHPBoAPOOUxcGyglGGsppkEhPNOK5UHK0YM9Th7ucnitw9IgQWnFtBS8fHXMpRef5VMXt8m04nWPPMh4PEWJ2VIKbWsZkwa37289dH+78s+R5BnfevEVnnv8C/yF976GTjfl7/zFc3RTOHk05y1veQ1vfevDMLrKjfX7eOr5TT7/xA0ee/ImL1zcZWevxNggDZfosFxRS0hySTdPQxLlPFdvFrx0acLvfPo6aSpYWUw5c7zHPacHnDuzyF2nFjhxdAlbforT6UXuOXeKdOVwKDuFA5Uw23Iqw2JGZ2a0CF+vYhWttyxnCJpG2iWAMWtAKbWYgyfM552b/Qxc/Dsb/z5Q1a01bGxbFg/0yfqCCxfG/NQvnecXP/EKu2NLvyNZ7EmqqsT42og849JirWChm/HI3Uu86f5lXn/fAvec7nJwJaHTkWSpaqjrQmY42WVYZnz0jxTfeulFxqNxcETOzZz4cGfdz+/u8fsEQtpbPmYG4byn08n5tY/9Nv/uP/0kv/CPvpsDvSlmOkS5CenyEeg/yHS8ibBjtASVBpHFyXDKS5d3eeaFTZ69sMWzFza58Moe126OGU9CTZ8mYYAixbyKmEdgjKesbNQD9mSZot/VLC9oFgea5YWM5UHGykLC0lKXxV5KnklSTTA0BYlWpKmKRidQKvZ4JEERTM2ErnwUd7IulK6hI+nZ3qvY3JmysTVhMg1bOxMdFL7DEEiQ6QB1G3Q1WaoYZIaHz/XZqfr8l994nl/8xCtcWZ/S7QQMY538em8pSstkaun3Ml5z1wrf/YYDvP3hRe4902WhL5o1PpXxUaRaRjaTBJUiVUKS91laXeWx8zkrJz/AoYMrodqK1YB2xrV6PX62Wny/1Lto/X28GdPplAsXXuT69T1ubuxxeCCYmjFeCrw6hSjGSDfB46kslONAu1VKc++da9x77hAQpFvXtye8eGmHZ17Y5PFn13ny/AaXrw/ZG1fgJYkOCyVCHx66WqGEinJqMJp4dvamOOsxdnvWIWyhlupV8DKKNIUMmpmWjp/J3NQGIMRMFt95HyBcNsi3Wx+UOuv+gG/yiRnhsRHEjtVXphzve+tRHn9uj+cvDen3UhZ6Oq5/CSATYwxlZTlyIOc9bzzKn3rHQV57T4+FXlh0OS0LtndjVdTsNRazRZ4QPJyUmKpgY3OPe+5YYYcJRRmXYYjASNZtd9BAiJoVb8wUJt0M6Vt/iakKNrevMxyVrG8NESe7eFdRqQOMhxW53iSJiZdoycc4D5PC4Kc+ijMIVhc7HFzt8abXHeW/N5bN7SkvXNzhifMbfPXpdZ48v8719QnOBQa991FH39dlGOgsqm37cLh1v17Eho5zFryeE2Fo70isc0HnPaWhAVjWyl41tzCRLSBus2Bi9n0aZRTf1gaK37co+JU/ukw3T1lZSMPBVxbrTLOgYrGn+TPfeYw//55DnLuji1SeaVmyPYrjZiGDdnBbpq5u89fAk1pevp7t2glZPqEoK5RwcR8B/P8Af+1o8Im6swsAAAAASUVORK5CYII='
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

    updateSoundButton();
    });

    // Theme toggle
    function toggleTheme() {
      const isLight = document.body.classList.toggle('light');
      localStorage.setItem('theme', isLight ? 'light' : 'dark');
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
        return \`<img class="avatar" src="\${avatarData[name]}" alt="\${name}">\`;
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
        const colors = avatarColors[info.user] || { bg: '#333', fg: '#888' };
        const initial = info.user[0].toUpperCase();
        const pc = getPresenceColor(info);
        const status = info.online ? 'online' : (info.lastSeen ? \`last seen \${Math.round((Date.now() - info.lastSeen) / 60000)}m ago\` : 'offline');
        return \`
          <div class="presence-avatar" title="\${info.user} - \${status}">
            <div class="ring" style="border-color:\${pc.ring};box-shadow:0 0 10px \${pc.shadow}"></div>
            <div class="avatar-placeholder" style="background:\${colors.bg};color:\${colors.fg}">\${initial}</div>
            <span class="name" style="color:\${pc.name}">\${info.user}</span>
          </div>
        \`;
      }).join('');
    }

    // Update presence colors every 30 seconds for fade effect
    setInterval(() => renderPresence(), 30000);

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
          console.log('SSE message:', { id: msg?.id, recipient: msg?.recipient, initialLoadComplete, alreadySeen: seenMessageIds.has(msg?.id), CURRENT_SENDER });
          if (msg?.id && seenMessageIds.has(msg.id)) return;
          if (msg?.id) seenMessageIds.add(msg.id);
          if (initialLoadComplete && msg?.recipient === CURRENT_SENDER) {
            console.log('Playing notification sound!');
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
        name: "Team Mailbox",
        short_name: "Mailbox",
        description: "Internal team messaging and coordination",
        start_url: "/ui",
        scope: "/ui",
        display: "standalone",
        background_color: "#18181b",
        theme_color: "#0ea5e9",
        icons: [{ src: "/ui/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }]
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
    
    // Static assets (avatars)
    const assetMatch = path.match(/^\/assets\/avatars\/([a-z]+)\.(svg|png|jpg)$/);
    if (method === "GET" && assetMatch) {
      return handleAvatar(assetMatch[1], assetMatch[2]);
    }
    
    // UI endpoints (no auth, internal only)
    if (path === "/ui") return handleUI();
    if (path === "/ui/messages") return handleUIMessages(request);
    if (path === "/ui/stream") return handleUIStream(request);
    if (path === "/ui/presence") return handlePresence();
    
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

    return error("Not found", 404);
  } catch (err) {
    console.error("[api] Unhandled error:", err);
    return error("Internal server error", 500);
  }
}

const server = Bun.serve({
  port: PORT,
  fetch: handleRequest,
});

console.log(`[mailbox-api] Listening on http://localhost:${PORT}`);

process.on("SIGINT", async () => {
  console.log("\n[mailbox-api] Shutting down...");
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
