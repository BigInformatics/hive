#!/usr/bin/env bun
// Hive SSE Monitor
//
// Keep a live SSE connection to Hive so agents receive realtime events.
// Auto-reconnects with exponential backoff. Forwards events to webhooks
// or executes callback commands for true Discord-like responsiveness.
//
// Required env:
//   MAILBOX_TOKEN        — Hive Bearer token
//
// Optional env:
//   HIVE_BASE_URL        — API base (default: https://messages.biginformatics.net/api)
//   WEBHOOK_URL          — POST events here (e.g. OpenClaw /hooks/agent)
//   WEBHOOK_TOKEN        — Bearer token for webhook endpoint
//   MONITOR_EVENTS       — Comma-separated event types to forward
//                          (default: chat_message,message,broadcast,swarm_task_created,swarm_task_updated,swarm_task_deleted)
//   MONITOR_VERBOSE      — Set to "true" for debug logging
//   MONITOR_CALLBACK     — Shell command to run on events (receives JSON on stdin)
//   MONITOR_AUTO_READ_CHAT — If "true", automatically POST /read on chat_message events (default: false)
//
// Examples:
//   # Forward chat messages to OpenClaw gateway
//   MAILBOX_TOKEN=xxx WEBHOOK_URL=http://host:18789/hooks/agent WEBHOOK_TOKEN=yyy \
//     bun run scripts/hive-sse-monitor.ts
//
//   # Run a custom script on each event
//   MAILBOX_TOKEN=xxx MONITOR_CALLBACK="bun run handle-event.ts" \
//     bun run scripts/hive-sse-monitor.ts
//
//   # Just log all events (debug mode)
//   MAILBOX_TOKEN=xxx MONITOR_VERBOSE=true bun run scripts/hive-sse-monitor.ts

const BASE = process.env.HIVE_BASE_URL ?? "https://messages.biginformatics.net/api";
const TOKEN = process.env.MAILBOX_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN;
const CALLBACK = process.env.MONITOR_CALLBACK;
const VERBOSE = process.env.MONITOR_VERBOSE === "true";
const AUTO_READ_CHAT = process.env.MONITOR_AUTO_READ_CHAT === "true";
const MONITORED_EVENTS = new Set(
  (process.env.MONITOR_EVENTS ?? "chat_message,message,broadcast,swarm_task_created,swarm_task_updated,swarm_task_deleted").split(",").map((s) => s.trim()),
);

if (!TOKEN) {
  console.error("[monitor] Missing MAILBOX_TOKEN");
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...args: unknown[]) => console.log(`[${new Date().toISOString()}]`, ...args);

// ─── Auth fetch helper ───

async function authFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res;
}

// ─── Event handlers ───

interface SSEEvent {
  type: string;
  data: unknown;
  raw: string;
}

async function handleChatMessage(evt: SSEEvent) {
  const data = evt.data as {
    channelId?: string;
    message?: { sender?: string; body?: string; id?: number };
  };
  const msg = data?.message;
  if (!msg) return;

  log(`💬 Chat from ${msg.sender}: "${msg.body?.slice(0, 80)}"`);

  // Forward to webhook (e.g. OpenClaw /hooks/agent)
  if (WEBHOOK_URL) {
    await forwardToWebhook(
      `New Hive chat message from ${msg.sender}: "${msg.body}"\n\nChannel: ${data.channelId}\nMessage ID: ${msg.id}\n\nTo reply: curl -sS -X POST -H "Authorization: Bearer $MAILBOX_TOKEN" -H "Content-Type: application/json" -d '{"body":"YOUR_REPLY"}' "${BASE}/chat/channels/${data.channelId}/messages"`,
    );
  }

  // Mark as read (OPTIONAL)
  // Default is OFF for safety: auto-read can hide messages before an agent has actually processed them.
  if (AUTO_READ_CHAT && data.channelId) {
    authFetch(`/chat/channels/${data.channelId}/read`, { method: "POST" }).catch(() => {});
  }
}

async function handleInboxMessage(evt: SSEEvent) {
  const data = evt.data as {
    sender?: string;
    title?: string;
    messageId?: number;
    urgent?: boolean;
  };

  log(`📬 Inbox from ${data?.sender}: "${data?.title}"`);

  if (WEBHOOK_URL) {
    await forwardToWebhook(
      `New Hive inbox message from ${data?.sender}: "${data?.title}"${data?.urgent ? " [URGENT]" : ""}\n\nMessage ID: ${data?.messageId}\n\nTo read: curl -sS -H "Authorization: Bearer $MAILBOX_TOKEN" "${BASE}/mailboxes/me/messages?status=unread"`,
    );
  }
}

async function handleSwarmEvent(evt: SSEEvent) {
  const data = evt.data as {
    taskId?: string;
    title?: string;
    status?: string;
    actor?: string;
  };

  log(`📋 Swarm: ${evt.type} — "${data?.title}" (${data?.status}) by ${data?.actor}`);

  if (WEBHOOK_URL) {
    await forwardToWebhook(
      `Swarm task update: ${evt.type}\nTask: "${data?.title}" → ${data?.status}\nBy: ${data?.actor}\nTask ID: ${data?.taskId}`,
    );
  }
}

async function handleBroadcast(evt: SSEEvent) {
  const data = evt.data as {
    appName?: string;
    title?: string;
    eventId?: number;
  };

  log(`📡 Broadcast [${data?.appName}]: "${data?.title}"`);

  if (WEBHOOK_URL) {
    await forwardToWebhook(
      `Hive broadcast from ${data?.appName}: "${data?.title}"\n\nEvent ID: ${data?.eventId}`,
    );
  }
}

const EVENT_HANDLERS: Record<string, (evt: SSEEvent) => Promise<void>> = {
  chat_message: handleChatMessage,
  message: handleInboxMessage,
  broadcast: handleBroadcast,
  swarm_task_created: handleSwarmEvent,
  swarm_task_updated: handleSwarmEvent,
  swarm_task_deleted: handleSwarmEvent,
};

// ─── Webhook forwarding ───

async function forwardToWebhook(message: string) {
  if (!WEBHOOK_URL) return;

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (WEBHOOK_TOKEN) headers.Authorization = `Bearer ${WEBHOOK_TOKEN}`;

    const resp = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ message, wakeMode: "now" }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      log(`⚠️  Webhook failed: ${resp.status}`);
    } else if (VERBOSE) {
      log(`✓ Webhook delivered`);
    }
  } catch (err) {
    log(`⚠️  Webhook error:`, err);
  }
}

// ─── Callback execution ───

async function runCallback(evt: SSEEvent) {
  if (!CALLBACK) return;

  try {
    const proc = Bun.spawn(CALLBACK.split(" "), {
      stdin: "pipe",
      stdout: "inherit",
      stderr: "inherit",
    });
    proc.stdin.write(JSON.stringify(evt));
    proc.stdin.end();
    await proc.exited;
  } catch (err) {
    log(`⚠️  Callback error:`, err);
  }
}

// ─── SSE connection ───

async function dispatch(evt: SSEEvent) {
  if (VERBOSE) log(`event=${evt.type}`, evt.data);

  // Run specific handler if available
  const handler = EVENT_HANDLERS[evt.type];
  if (handler) {
    await handler(evt).catch((err) => log(`⚠️  Handler error (${evt.type}):`, err));
  }

  // Run generic callback if configured
  if (CALLBACK && MONITORED_EVENTS.has(evt.type)) {
    await runCallback(evt).catch((err) => log(`⚠️  Callback error:`, err));
  }
}

async function connectOnce() {
  const url = `${BASE}/stream?token=${encodeURIComponent(TOKEN!)}`;
  log(`🔌 Connecting to SSE...`);

  const res = await fetch(url, { headers: { Accept: "text/event-stream" } });
  if (!res.ok || !res.body) throw new Error(`SSE connect failed: ${res.status}`);

  log(`✅ Connected`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let buf = "";
  let eventType: string | null = null;
  let dataLines: string[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buf += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);

      if (line === "") {
        if (eventType && MONITORED_EVENTS.has(eventType)) {
          const raw = dataLines.join("\n");
          let data: unknown;
          try {
            data = JSON.parse(raw);
          } catch {
            data = raw;
          }
          dispatch({ type: eventType, data, raw }).catch(() => {});
        } else if (eventType === "connected") {
          log(`🐝 Authenticated`);
        }
        eventType = null;
        dataLines = [];
        continue;
      }

      if (line.startsWith(":")) continue; // heartbeat
      if (line.startsWith("event:")) eventType = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
  }

  throw new Error("SSE stream ended");
}

// ─── Main loop with reconnect ───

async function main() {
  log(`🐝 Hive SSE Monitor starting`);
  log(`   Base: ${BASE}`);
  log(`   Webhook: ${WEBHOOK_URL ?? "(none)"}`);
  log(`   Callback: ${CALLBACK ?? "(none)"}`);
  log(`   Events: ${[...MONITORED_EVENTS].join(", ")}`);
  log(`   Verbose: ${VERBOSE}`);

  // Initial presence ping
  await authFetch("/presence").catch(() => {});

  let backoffMs = 1000;
  while (true) {
    try {
      await connectOnce();
    } catch (err) {
      log(`⚠️  Disconnected:`, err);
    }
    log(`🔄 Reconnecting in ${backoffMs}ms...`);
    await sleep(backoffMs);
    backoffMs = Math.min(backoffMs * 2, 30_000);
  }
}

main().catch((err) => {
  console.error("[monitor] Fatal:", err);
  process.exit(1);
});
