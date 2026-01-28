// Mailbox API Server
import { healthCheck, close } from "./db/client";
import { 
  sendMessage, listMessages, getMessage, 
  ackMessage, ackMessages, searchMessages,
  isValidMailbox, listAllMessages,
  type SendMessageInput 
} from "./db/messages";
import { authenticate, initFromEnv, type AuthContext } from "./middleware/auth";

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
  <meta name="theme-color" content="#2563eb">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="manifest" href="/manifest.json">
  <link rel="icon" href="/icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/icon.svg">
  <title>Mailbox Viewer</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 20px; }
    h1 { margin-bottom: 16px; font-size: 1.5rem; color: #fff; }
    .controls { margin-bottom: 16px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    select, button { padding: 8px 12px; border-radius: 6px; border: 1px solid #333; background: #1a1a1a; color: #e5e5e5; cursor: pointer; }
    select:hover, button:hover { border-color: #555; }
    .status { font-size: 0.875rem; color: #888; }
    .status.connected { color: #4ade80; }
    .messages { display: flex; flex-direction: column; gap: 8px; }
    .message { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 12px; }
    .message.urgent { border-left: 3px solid #f59e0b; }
    .message.unread { background: #1f1f1f; }
    .message-header { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 0.875rem; }
    .message-meta { color: #888; }
    .message-meta .sender { color: #60a5fa; }
    .message-meta .recipient { color: #a78bfa; }
    .avatar { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; margin-right: 8px; flex-shrink: 0; }
    .avatar-placeholder { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 14px; margin-right: 8px; flex-shrink: 0; text-transform: uppercase; }
    .message-row { display: flex; align-items: flex-start; }
    .message-content { flex: 1; min-width: 0; }
    .message-title { font-weight: 600; margin-bottom: 4px; }
    .message-body { color: #aaa; font-size: 0.875rem; white-space: pre-wrap; }
    .badge { font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; }
    .badge.urgent { background: #78350f; color: #fcd34d; }
    .badge.unread { background: #1e3a5f; color: #93c5fd; }
    .new-message { animation: highlight 2s ease-out; }
    @keyframes highlight { from { background: #2a2a1a; } to { background: #1a1a1a; } }
  </style>
</head>
<body>
  <h1>📬 Mailbox Viewer</h1>
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
    <button class="theme-toggle" onclick="toggleTheme()" title="Toggle light/dark mode">🌓</button>
  </div>
  <div id="messages" class="messages"></div>

  <script>
    let eventSource = null;
    let lastId = null;

    // Avatar images (base64 embedded, 64x64 jpg)
    const avatarData = {
      chris: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij4KICA8Y2lyY2xlIGN4PSIzMiIgY3k9IjMyIiByPSIzMiIgZmlsbD0iIzFlM2E1ZiIvPgogIDx0ZXh0IHg9IjMyIiB5PSI0MiIgZm9udC1mYW1pbHk9InN5c3RlbS11aSwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyOCIgZm9udC13ZWlnaHQ9IjYwMCIgZmlsbD0iIzkzYzVmZCIgdGV4dC1hbmNob3I9Im1pZGRsZSI+QzwvdGV4dD4KPC9zdmc+Cg==',
      clio: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij4KICA8Y2lyY2xlIGN4PSIzMiIgY3k9IjMyIiByPSIzMiIgZmlsbD0iIzNmMWU1ZiIvPgogIDx0ZXh0IHg9IjMyIiB5PSI0MiIgZm9udC1mYW1pbHk9InN5c3RlbS11aSwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyOCIgZm9udC13ZWlnaHQ9IjYwMCIgZmlsbD0iI2M0YjVmZCIgdGV4dC1hbmNob3I9Im1pZGRsZSI+QzwvdGV4dD4KPC9zdmc+Cg==',
      domingo: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij4KICA8Y2lyY2xlIGN4PSIzMiIgY3k9IjMyIiByPSIzMiIgZmlsbD0iIzFlNWYzYSIvPgogIDx0ZXh0IHg9IjMyIiB5PSI0MiIgZm9udC1mYW1pbHk9InN5c3RlbS11aSwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyOCIgZm9udC13ZWlnaHQ9IjYwMCIgZmlsbD0iIzg2ZWZhYyIgdGV4dC1hbmNob3I9Im1pZGRsZSI+RDwvdGV4dD4KPC9zdmc+Cg==',
      zumie: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij4KICA8Y2lyY2xlIGN4PSIzMiIgY3k9IjMyIiByPSIzMiIgZmlsbD0iIzVmM2ExZSIvPgogIDx0ZXh0IHg9IjMyIiB5PSI0MiIgZm9udC1mYW1pbHk9InN5c3RlbS11aSwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyOCIgZm9udC13ZWlnaHQ9IjYwMCIgZmlsbD0iI2ZjZDM0ZCIgdGV4dC1hbmNob3I9Im1pZGRsZSI+WjwvdGV4dD4KPC9zdmc+Cg=='
    }
    const avatarColors = {
      chris: { bg: '#1e3a5f', fg: '#93c5fd' },
      clio: { bg: '#3f1e5f', fg: '#c4b5fd' },
      domingo: { bg: '#1e5f3a', fg: '#86efac' },
      zumie: { bg: '#5f3a1e', fg: '#fcd34d' }
    };

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

    function connectSSE() {
      const recipient = document.getElementById('recipient').value;
      const url = recipient ? '/ui/stream?recipient=' + recipient : '/ui/stream';
      
      if (eventSource) {
        eventSource.close();
      }
      
      eventSource = new EventSource(url);
      
      eventSource.onopen = () => {
        document.getElementById('status').textContent = '🟢 Connected (live)';
        document.getElementById('status').className = 'status connected';
      };
      
      eventSource.onerror = () => {
        document.getElementById('status').textContent = '🔴 Disconnected';
        document.getElementById('status').className = 'status';
        setTimeout(connectSSE, 3000);
      };
      
      let refreshTimeout = null;
      eventSource.addEventListener('message', (e) => {
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

// UI endpoint: SSE stream (no auth, internal only)
async function handleUIStream(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const recipient = url.searchParams.get("recipient") || undefined;
  
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      
      controller.enqueue(encoder.encode(`: connected to UI stream\n\n`));
      
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
  <meta name="theme-color" content="#2563eb">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="manifest" href="/manifest.json">
  <link rel="icon" href="/icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/icon.svg">
  <title>Mailbox - ${sender}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 20px; }
    h1 { margin-bottom: 16px; font-size: 1.5rem; color: #fff; }
    .controls { margin-bottom: 16px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    select, button, input, textarea { padding: 8px 12px; border-radius: 6px; border: 1px solid #333; background: #1a1a1a; color: #e5e5e5; font-family: inherit; font-size: 14px; }
    select:hover, button:hover { border-color: #555; }
    button { cursor: pointer; }
    button.primary { background: #2563eb; border-color: #2563eb; }
    button.primary:hover { background: #1d4ed8; }
    .status { font-size: 0.875rem; color: #888; }
    .status.connected { color: #4ade80; }
    .messages { display: flex; flex-direction: column; gap: 8px; }
    .message { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 12px; cursor: pointer; }
    .message:hover { border-color: #555; }
    .message.selected { border-color: #2563eb; background: #1e293b; }
    .message.urgent { border-left: 3px solid #f59e0b; }
    .message.unread { background: #1f1f1f; }
    .message-header { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 0.875rem; }
    .message-meta { color: #888; }
    .message-meta .sender { color: #60a5fa; }
    .message-meta .recipient { color: #a78bfa; }
    .avatar { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; margin-right: 8px; flex-shrink: 0; }
    .avatar-placeholder { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 14px; margin-right: 8px; flex-shrink: 0; text-transform: uppercase; }
    .message-row { display: flex; align-items: flex-start; }
    .message-content { flex: 1; min-width: 0; }
    .message-title { font-weight: 600; margin-bottom: 4px; }
    .message-body { color: #aaa; font-size: 0.875rem; white-space: pre-wrap; }
    .badge { font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; }
    .badge.urgent { background: #78350f; color: #fcd34d; }
    .badge.unread { background: #1e3a5f; color: #93c5fd; }
    .new-message { animation: highlight 2s ease-out; }
    @keyframes highlight { from { background: #2a2a1a; } to { background: #1a1a1a; } }
    .compose { background: #111; border: 1px solid #333; border-radius: 8px; margin-bottom: 16px; }
    .compose-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; cursor: pointer; }
    .compose-header:hover { background: #1a1a1a; border-radius: 8px; }
    .compose-header h2 { font-size: 1rem; margin: 0; color: #fff; }
    .compose-toggle { color: #888; font-size: 0.875rem; }
    .compose-body { padding: 0 16px 16px; }
    .compose.collapsed .compose-body { display: none; }
    .compose.collapsed .compose-header { border-radius: 8px; }
    /* Light mode */
    body.light { background: #f5f5f5; color: #1a1a1a; }
    body.light h1 { color: #000; }
    body.light select, body.light button, body.light input, body.light textarea { background: #fff; color: #1a1a1a; border-color: #ccc; }
    body.light .compose { background: #fff; border-color: #ddd; }
    body.light .compose-header:hover { background: #f0f0f0; }
    body.light .message { background: #fff; border-color: #ddd; }
    body.light .message:hover { border-color: #bbb; }
    body.light .message.selected { background: #e0e7ff; border-color: #2563eb; }
    body.light .message.unread { background: #f8f8f8; }
    body.light .message-meta { color: #666; }
    body.light .message-body { color: #444; }
    body.light .avatar-placeholder { opacity: 0.9; }
    body.light .reply-info { background: #e0e7ff; }
    /* Filter controls */
    .filters { display: flex; gap: 16px; align-items: center; }
    .filter-label { display: flex; align-items: center; gap: 6px; font-size: 0.875rem; color: #888; cursor: pointer; }
    .filter-label input { cursor: pointer; }
    body.light .filter-label { color: #666; }
    /* Mark read button */
    .mark-read-btn { font-size: 0.75rem; padding: 4px 8px; margin-left: 8px; background: #1e3a5f; border-color: #1e3a5f; color: #93c5fd; }
    .mark-read-btn:hover { background: #2563eb; }
    body.light .mark-read-btn { background: #dbeafe; border-color: #93c5fd; color: #1e40af; }
    /* Theme toggle */
    .theme-toggle { margin-left: auto; font-size: 1.25rem; background: transparent; border: none; cursor: pointer; padding: 4px 8px; }
    .compose-row { display: flex; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; }
    .compose-row label { color: #888; font-size: 0.875rem; min-width: 80px; }
    .compose-row input[type="text"], .compose-row textarea { flex: 1; min-width: 200px; }
    .compose-row textarea { min-height: 80px; resize: vertical; }
    .compose-row .checkbox-label { display: flex; align-items: center; gap: 8px; }
    .compose-actions { display: flex; gap: 12px; align-items: center; }
    .compose-status { font-size: 0.875rem; margin-left: 12px; }
    .compose-status.success { color: #4ade80; }
    .compose-status.error { color: #f87171; }
    .reply-info { font-size: 0.875rem; color: #60a5fa; margin-bottom: 12px; padding: 8px; background: #1e293b; border-radius: 4px; }
  </style>
</head>
<body>
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
    <button class="theme-toggle" onclick="toggleTheme()" title="Toggle light/dark mode">🌓</button>
  </div>
  <div id="messages" class="messages"></div>

  <script>
    const MAILBOX_KEY = '${key}';
    let eventSource = null;
    let lastId = null;
    let selectedMessage = null;
    let replyToId = null;
    const CURRENT_SENDER = '${sender}';

    const avatarData = {
      chris: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij4KICA8Y2lyY2xlIGN4PSIzMiIgY3k9IjMyIiByPSIzMiIgZmlsbD0iIzFlM2E1ZiIvPgogIDx0ZXh0IHg9IjMyIiB5PSI0MiIgZm9udC1mYW1pbHk9InN5c3RlbS11aSwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyOCIgZm9udC13ZWlnaHQ9IjYwMCIgZmlsbD0iIzkzYzVmZCIgdGV4dC1hbmNob3I9Im1pZGRsZSI+QzwvdGV4dD4KPC9zdmc+Cg==',
      clio: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij4KICA8Y2lyY2xlIGN4PSIzMiIgY3k9IjMyIiByPSIzMiIgZmlsbD0iIzNmMWU1ZiIvPgogIDx0ZXh0IHg9IjMyIiB5PSI0MiIgZm9udC1mYW1pbHk9InN5c3RlbS11aSwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyOCIgZm9udC13ZWlnaHQ9IjYwMCIgZmlsbD0iI2M0YjVmZCIgdGV4dC1hbmNob3I9Im1pZGRsZSI+QzwvdGV4dD4KPC9zdmc+Cg==',
      domingo: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij4KICA8Y2lyY2xlIGN4PSIzMiIgY3k9IjMyIiByPSIzMiIgZmlsbD0iIzFlNWYzYSIvPgogIDx0ZXh0IHg9IjMyIiB5PSI0MiIgZm9udC1mYW1pbHk9InN5c3RlbS11aSwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyOCIgZm9udC13ZWlnaHQ9IjYwMCIgZmlsbD0iIzg2ZWZhYyIgdGV4dC1hbmNob3I9Im1pZGRsZSI+RDwvdGV4dD4KPC9zdmc+Cg==',
      zumie: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij4KICA8Y2lyY2xlIGN4PSIzMiIgY3k9IjMyIiByPSIzMiIgZmlsbD0iIzVmM2ExZSIvPgogIDx0ZXh0IHg9IjMyIiB5PSI0MiIgZm9udC1mYW1pbHk9InN5c3RlbS11aSwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyOCIgZm9udC13ZWlnaHQ9IjYwMCIgZmlsbD0iI2ZjZDM0ZCIgdGV4dC1hbmNob3I9Im1pZGRsZSI+WjwvdGV4dD4KPC9zdmc+Cg=='
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
    });

    // Theme toggle
    function toggleTheme() {
      const isLight = document.body.classList.toggle('light');
      localStorage.setItem('theme', isLight ? 'light' : 'dark');
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
      }
    }

    function connectSSE() {
      const recipient = document.getElementById('recipient').value;
      const url = recipient ? '/ui/stream?recipient=' + recipient : '/ui/stream';
      
      if (eventSource) eventSource.close();
      eventSource = new EventSource(url);
      
      eventSource.onopen = () => {
        document.getElementById('status').textContent = '🟢 Connected (live)';
        document.getElementById('status').className = 'status connected';
      };
      
      eventSource.onerror = () => {
        document.getElementById('status').textContent = '🔴 Disconnected';
        document.getElementById('status').className = 'status';
        setTimeout(connectSSE, 3000);
      };
      
      let refreshTimeout = null;
      eventSource.addEventListener('message', (e) => {
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
  const path = url.pathname;

  try {
    if (path === "/healthz") return handleHealthz();
    if (path === "/skill") return handleSkill();
    if (path === "/readyz") return handleReadyz();
    
    // PWA manifest and icon
    if (path === "/manifest.json") {
      return new Response(JSON.stringify({
        name: "Team Mailbox",
        short_name: "Mailbox",
        description: "Internal team messaging and coordination",
        start_url: "/ui",
        display: "standalone",
        background_color: "#0a0a0a",
        theme_color: "#2563eb",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }]
      }), { headers: { "Content-Type": "application/manifest+json" } });
    }
    
    if (path === "/icon.svg") {
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
  
  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      
      // Send initial connection event
      controller.enqueue(encoder.encode(`: connected to mailbox stream for ${recipient}\n\n`));
      
      // Ping every 30 seconds to keep connection alive
      const pingInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(pingInterval);
        }
      }, 30000);
      
      // Poll for new messages every 5 seconds
      // (In production, this would use Postgres NOTIFY/LISTEN)
      let lastSeenId = 0n;
      const pollInterval = setInterval(async () => {
        try {
          const result = await listMessages(recipient, { 
            status: "unread", 
            limit: 10,
            sinceId: lastSeenId > 0n ? lastSeenId : undefined 
          });
          
          for (const msg of result.messages) {
            if (BigInt(msg.id) > lastSeenId) {
              const event = {
                id: msg.id.toString(),
                sender: msg.sender,
                title: msg.title,
                urgent: msg.urgent,
                createdAt: msg.createdAt.toISOString(),
              };
              controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(event)}\n\n`));
              lastSeenId = BigInt(msg.id);
            }
          }
        } catch (err) {
          console.error("[sse] Poll error:", err);
        }
      }, 5000);
      
      // Cleanup on close
      return () => {
        clearInterval(pingInterval);
        clearInterval(pollInterval);
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
