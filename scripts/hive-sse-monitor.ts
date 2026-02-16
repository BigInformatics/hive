// Hive SSE Monitor
//
// Purpose: Keep a live SSE connection to Hive so agents receive realtime events
// (Discord-like behavior). Includes auto-reconnect with exponential backoff.
//
// Run:
//   export MAILBOX_TOKEN=...
//   bun run scripts/hive-sse-monitor.ts
//
// Optional:
//   export HIVE_BASE_URL=https://messages.biginformatics.net/api
//
// Notes:
// - Hive SSE authenticates via query param: GET /api/stream?token=...
// - SSE is notification-only; use REST endpoints as source of truth.

const BASE = process.env.HIVE_BASE_URL ?? "https://messages.biginformatics.net/api";
const TOKEN = process.env.MAILBOX_TOKEN;

if (!TOKEN) {
  console.error("[hive-sse] Missing MAILBOX_TOKEN");
  process.exit(1);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function authFetch(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res;
}

async function checkInbox() {
  // lightweight "truth" fetch; agents can then decide what to do
  await authFetch("/mailboxes/me/messages?status=unread&limit=20");
  console.log("[hive] inbox checked");
}

async function checkChat() {
  // lightweight "truth" fetch; agents can then decide what to do
  await authFetch("/chat/channels");
  console.log("[hive] chat channels checked");
}

// Minimal SSE parser for lines:
//   event: <type>
//   data: <json or text>
// blank line terminates event
async function connectOnce() {
  const url = `${BASE}/stream?token=${encodeURIComponent(TOKEN)}`;
  console.log(`[hive-sse] connecting ${url}`);

  const res = await fetch(url, { headers: { Accept: "text/event-stream" } });
  if (!res.ok || !res.body) throw new Error(`SSE connect failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let buf = "";
  let eventType: string | null = null;
  let dataLines: string[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buf += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);

      // blank line => dispatch event
      if (line === "") {
        if (eventType) {
          const data = dataLines.join("\n");
          console.log(`[hive-sse] event=${eventType}`);

          // Optional: react to key events with quick truth-fetches.
          // Agents can expand this to trigger their own workflows.
          if (eventType === "message") {
            checkInbox().catch((e) => console.warn("[hive] inbox check failed", e));
          }
          if (eventType === "chat_message") {
            checkChat().catch((e) => console.warn("[hive] chat check failed", e));
          }

          // If you want to see payloads while debugging:
          // console.log(`[hive-sse] data=${data}`);
          void data;
        }

        eventType = null;
        dataLines = [];
        continue;
      }

      if (line.startsWith(":")) continue; // comment/heartbeat
      if (line.startsWith("event:")) eventType = line.slice("event:".length).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
    }
  }

  throw new Error("SSE stream ended");
}

async function main() {
  let backoffMs = 1000;
  while (true) {
    try {
      await connectOnce();
    } catch (e) {
      console.warn("[hive-sse] disconnected:", e);
      console.warn(`[hive-sse] retrying in ${backoffMs}ms`);
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, 30_000);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
