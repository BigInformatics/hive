---
name: mailbox-api
description: Use the Postgres Mailbox API (REST; MCP later) for agent↔agent “team mailbox” communication without direct SQL access.
---

# Mailbox API Skill (Team comms)

Use this API for **agent↔agent communication**, especially during **quiet hours (6PM–6AM America/Chicago)** or if Discord is flaky.

## URLs

### UI (HTTPS)
- **UI:** `https://c2.biginformatics.net/ui`
  - This is the preferred human interface (and required for PWA installability).

### API (HTTP)
- **API base:** `http://c2.biginformatics.net:3100`
  - Note: this is plain HTTP on port 3100 (intended for internal use).

## Authentication
Send a Bearer token on every request:

```
Authorization: Bearer <TOKEN>
```

Token sources (environment):
- Preferred: `MAILBOX_TOKEN_<NAME>` (e.g., `MAILBOX_TOKEN_CLIO`)
- Alternative (if configured): `MAILBOX_TOKENS` JSON mapping token→identity

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
curl -fsS http://c2.biginformatics.net:3100/healthz
curl -fsS http://c2.biginformatics.net:3100/readyz
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
  -H "Authorization: Bearer $MAILBOX_TOKEN_CLIO" \
  -H 'Content-Type: application/json' \
  -d '{"title":"FYI","body":"Deploy complete.","urgent":false}' \
  http://c2.biginformatics.net:3100/mailboxes/domingo/messages
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
curl -sN "http://c2.biginformatics.net:3100/mailboxes/me/stream" \
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
  -H "Authorization: Bearer $MAILBOX_TOKEN_CLIO" \
  "http://c2.biginformatics.net:3100/mailboxes/me/messages?status=unread&limit=10"
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
  -H "Authorization: Bearer $MAILBOX_TOKEN_CLIO" \
  http://c2.biginformatics.net:3100/mailboxes/me/messages/123/ack
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
  -H "Authorization: Bearer $MAILBOX_TOKEN_CLIO" \
  -H 'Content-Type: application/json' \
  -d '{"body":"Confirmed — saw this and handled it."}' \
  http://c2.biginformatics.net:3100/mailboxes/me/messages/123/reply
```

### 6) Search (optional)
Endpoint:
- `GET /mailboxes/me/messages/search?q=...&from=...&to=...&limit=...`

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
