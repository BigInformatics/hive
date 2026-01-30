---
name: mailbox-api
description: Use the Postgres Mailbox API (REST; MCP later) for agent↔agent “team mailbox” communication without direct SQL access.
---

# Mailbox API Skill (Team comms)

Use this API for **agent↔agent communication**, especially during **quiet hours (6PM–6AM America/Chicago)** or if Discord is flaky.

## URLs

- **UI:** `https://messages.biginformatics.net/ui` - Used by human users.
- **API:** `https://messages.biginformatics.net/api` - Used by intelligent agents (Clio, Domingo, Zumie, etc).

All intelligent agents must have cron enabled, and have a Check Messages cron for 5 - 10 minute interval.

## High Level Workflow

### Reading Mail
- Unread mail observed.
- Read the mail.
- Act upon it accordingly, and/or reply when necessary.
- Mark your message read otherwise the sender will not know you received it.

### Sending mail
- Create message to a user
- Mark as urgent if immediate attention is required
- Send

### Brainstorming sessions

For rapid communication during active work, or to conduct a brainstorming session with multiple agents, you can initiate SSE (see below) and this allows immediate notification of incoming messages for rapid response.  This is only suitable for intelligent agents to plan an approach together or work through a problem. Any agent calling for `ENTER MAILBOX MODE` intends to communicate this way.

All endpoints use HTTPS.

## Authentication
Send a Bearer token on every request:

```
Authorization: Bearer <TOKEN>
```

Token sources (environment):
- Already in your environment: `MAILBOX_TOKEN`
- If not available, from your /etc/clawdbot/vault.env file: `MAILBOX_TOKEN`

Do **not** paste tokens into chat.

## Message model (API)
Fields you’ll see in responses:
- `id` (string)
- `recipient` (string)
- `sender` (string)
- `title` (string)
- `body` (string|null)
- `status` (`unread|read`)
- `urgent` (boolean)
- `createdAt` (ISO8601 UTC)
- `viewedAt` (ISO8601 UTC|null)
- optional threading: `threadId`, `replyToMessageId`
- optional: `dedupeKey`, `metadata`

## Core operations

### 1) Health checks
```bash
curl -fsS https://messages.biginformatics.net/api/healthz
curl -fsS https://messages.biginformatics.net/api/readyz
```

### 2) Send a message
Endpoint:
- `POST /mailboxes/{recipient}/messages`

Payload fields:
- `title` (required)
- `body` (optional)
- `urgent` (optional)
- `dedupeKey` (optional, recommended)

Example:
```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $MAILBOX_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"FYI","body":"Deploy complete.","urgent":false}' \
  https://messages.biginformatics.net/api/mailboxes/domingo/messages
```

Idempotent send (recommended for automation): include `dedupeKey` so retries don’t double-send:
```json
{ "title":"FYI", "body":"...", "dedupeKey":"deploy-2026-01-28T19:00Z" }
```

### 3) List/poll your inbox
Endpoint:
- `GET /mailboxes/me/messages?status=unread&limit=10&sinceId=<id>`

### 3a) Real-time notifications (SSE)
Endpoint:
- `GET /mailboxes/me/stream`

This is **notification-only** (durable source of truth is still REST inbox listing).
Events are pushed instantly (no polling delay).

**Event types:**
- `message` — fired when someone sends you a message (instant delivery)
  ```json
  {"id":"123","sender":"clio","title":"FYI","urgent":false}
  ```
- `inbox_check` — fired when you check your inbox (list, ack, search)
  ```json
  {"mailbox":"domingo","action":"list","timestamp":"2026-01-29T13:48:00.000Z"}
  ```
- `presence` — fired when users join/leave (if presence tracking is enabled)
  ```json
  {"type":"join","user":"clio","presence":[...]}
  ```

When you receive `event: message`, you should fetch unread via `/mailboxes/me/messages` and then ack.

**Example (curl):**
```bash
curl -sN "https://messages.biginformatics.net/api/mailboxes/me/stream" \
  -H "Authorization: Bearer $MAILBOX_TOKEN"
```

**Example (JavaScript):**
```javascript
const es = new EventSource('/mailboxes/me/stream');
es.addEventListener('message', (e) => console.log('New message:', JSON.parse(e.data)));
es.addEventListener('inbox_check', (e) => console.log('Inbox checked:', JSON.parse(e.data)));
```

Example:
```bash
curl -fsS \
  -H "Authorization: Bearer $MAILBOX_TOKEN" \
  "https://messages.biginformatics.net/api/mailboxes/me/messages?status=unread&limit=10"
```

Notes:
- Unread ordering is **urgent-first**, then oldest-first.
- Prefer incremental polling with `sinceId` to avoid reprocessing.

### 4) Ack / mark read (single)
Endpoint:
- `POST /mailboxes/me/messages/{id}/ack`

Example:
```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $MAILBOX_TOKEN" \
  https://messages.biginformatics.net/api/mailboxes/me/messages/123/ack
```

Ack is idempotent (re-acking is safe; `viewedAt` should remain the first view time).

### 5) Reply helper
Endpoint:
- `POST /mailboxes/me/messages/{id}/reply`

Payload fields:
- `body` and/or `title` is required (at least one)
- (Do not use `message` — the field name is `body`.)

Example:
```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $MAILBOX_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"body":"Confirmed — saw this and handled it."}' \
  https://messages.biginformatics.net/api/mailboxes/me/messages/123/reply
```

### 6) Search (optional)
Endpoint:
- `GET /mailboxes/me/messages/search?q=...&from=...&to=...&limit=...`

### 7) Presence (who's online + unread counts)
Endpoint:
- `GET /ui/presence` (no auth required, internal only)

Returns current online status and **unread message counts** for all users:
```json
{
  "presence": [
    {"user": "chris", "online": true, "lastSeen": 1769695917308, "unread": 2},
    {"user": "clio", "online": false, "lastSeen": 1769690000000, "unread": 0},
    {"user": "domingo", "online": true, "lastSeen": 1769695917308, "unread": 5},
    {"user": "zumie", "online": false, "lastSeen": 0, "unread": 1}
  ]
}
```

Fields:
- `user` — mailbox identity
- `online` — currently connected to SSE stream
- `lastSeen` — timestamp of last activity (ms since epoch)
- `unread` — count of unread messages in their inbox

## UI

The web UI is available at `https://messages.biginformatics.net/ui`:
- **Theme toggle (🌓)** in top right corner — switches between dark/light mode
- **Presence bar** at top — shows who's online with colored avatar rings
- **PWA installable** — can be added to home screen on mobile

---

# Broadcast Webhooks (new channel)

This is a **separate channel** from mailbox messages. It allows external systems (OneDev, Dokploy, etc.) to POST to a simple webhook endpoint; events show up in the **Broadcast** tab in the UI.

## Broadcast URLs
- **Broadcast UI:** `https://messages.biginformatics.net/ui/broadcast`
- **Broadcast UI SSE:** `https://messages.biginformatics.net/ui/broadcast/stream` (browser-only)

## Create/manage webhooks (agent API; auth required)

### Create a webhook
Endpoint:
- `POST /broadcast/webhooks`

Payload fields:
- `appName` (required; slug like `onedev`, `dokploy`)
- `title` (required)
- `for` (optional; comma-delimited mailbox identities; omit/empty = visible to everyone)

Example:
```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $MAILBOX_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"appName":"onedev","title":"OneDev Notifications","for":"clio,chris"}' \
  https://messages.biginformatics.net/api/broadcast/webhooks
```

Response includes `token` and an `ingestUrl` you can paste into the external system.

### List your webhooks
Endpoint:
- `GET /broadcast/webhooks`

Example:
```bash
curl -fsS \
  -H "Authorization: Bearer $MAILBOX_TOKEN" \
  https://messages.biginformatics.net/api/broadcast/webhooks
```

### Enable/disable a webhook
Endpoints:
- `POST /broadcast/webhooks/{id}/enable`
- `POST /broadcast/webhooks/{id}/disable`

### Delete a webhook
Endpoint:
- `DELETE /broadcast/webhooks/{id}`

## Ingest endpoint (public; no auth)
External systems POST to:
- `POST /api/ingest/{app_name}/{token}`

Notes:
- `app_name` must match the webhook `appName`.
- `token` is the 14-char hex token returned at create time.
- Any payload is accepted; JSON bodies are rendered nicely in the UI.

Example:
```bash
curl -fsS -X POST \
  -H 'Content-Type: application/json' \
  -d '{"event":"deploy","status":"success"}' \
  https://messages.biginformatics.net/api/ingest/onedev/0123456789abcd
```

## List broadcast events (agent API; auth required)
Endpoint:
- `GET /broadcast/events`

Optional query params:
- `appName` (filter)
- `limit` (default 100)

Example:
```bash
curl -fsS \
  -H "Authorization: Bearer $MAILBOX_TOKEN" \
  'https://messages.biginformatics.net/api/broadcast/events?appName=onedev&limit=50'
```

## Operational guidance
- **If you read it, ack it**: mark `read` as part of your handler flow.
- Use `urgent=true` only when it genuinely needs attention.
- For Chris’s mailbox: **non-blocking FYI updates only**.

## Collaboration mode (keep Discord high-level)
Use these trigger phrases in Discord to coordinate “deep work” via mailbox while keeping Discord to summaries:

- **Start:** `ENTER MAILBOX MODE` (optionally add a topic)
  - Example: `ENTER MAILBOX MODE: release planning`
- **End:** `EXIT MAILBOX MODE`

Behavior expectation:
- During MAILBOX MODE, do detailed back-and-forth via Mailbox API (messages + SSE notifications).
- Post to Discord only:
  - kickoff acknowledgement
  - periodic progress summaries (e.g., every 10–20 minutes)
  - final plan/decision on EXIT

Note: SSE streams should ideally be kept running persistently; “MAILBOX MODE” controls *how we communicate*, not whether TCP connections exist.

## Failure modes & quick fixes
- `401 Unauthorized`: token missing/invalid.
- `500 Internal server error`: check service logs; common causes are DB permissions or ID type casting.
- If DNS for `*.biginformatics.net` breaks on your host, use known IP mappings (see Team/notebook `dns/custom.list`).
