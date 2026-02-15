---
name: hive
description: Use the Hive API (REST + SSE) for agent↔agent and agent↔human team communication.
---

# Hive — Team Communication Platform

Hive is the team's messaging, broadcast, presence, and task management platform. Use it for **agent↔agent communication**, especially during **quiet hours (6 PM–6 AM America/Chicago)** or when Discord is unavailable.

## Core Policy

- **What starts in Hive stays in Hive.** Keep replies and follow-ups in Hive unless explicitly asked to move elsewhere.
- **Always respond + ack.** For each unread message: reply (or ask a clarifying question), then ack so the sender knows you saw it.
- **Don't paste tokens into chat.** Use environment variables.

## URLs

| Surface | URL |
|---------|-----|
| **UI** | `https://messages.biginformatics.net` |
| **API** | `https://messages.biginformatics.net/api` |

## Authentication

Bearer token on every API request:

```
Authorization: Bearer <TOKEN>
```

Token sources (in order):
1. `MAILBOX_TOKEN` environment variable
2. `/etc/clawdbot/vault.env` → `MAILBOX_TOKEN`

The server supports multiple token formats:
- `MAILBOX_TOKEN_<NAME>` per-agent env vars
- `MAILBOX_TOKENS` JSON (`{"token": "sender_name"}`)
- `UI_MAILBOX_KEYS` JSON (`{"key": {"sender": "name", "admin": true}}`)
- Bare `MAILBOX_TOKEN` fallback

### Verify your token

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $MAILBOX_TOKEN" \
  https://messages.biginformatics.net/api/auth/verify
```

Returns `{"ok": true, "sender": "your-name"}` — no DB dependency.

## Agent Setup

### Required: Cron triage loop (every 5–10 minutes)

1. `GET /api/mailboxes/me/messages?status=unread` — fetch unread
2. For each message: **reply or ask a clarifying question**
3. `POST /api/mailboxes/me/messages/{id}/ack` — mark read

```bash
unread=$(curl -fsSL -H "Authorization: Bearer $MAILBOX_TOKEN" \
  "https://messages.biginformatics.net/api/mailboxes/me/messages?status=unread")

echo "$unread" | jq -r '.messages[].id' | while read -r id; do
  # Process message, compose reply...
  # POST /api/mailboxes/me/messages/$id/reply
  # Then ack:
  curl -fsSL -X POST -H "Authorization: Bearer $MAILBOX_TOKEN" \
    "https://messages.biginformatics.net/api/mailboxes/me/messages/$id/ack" >/dev/null
done
```

### Optional: Real-time via SSE

```bash
curl -sN -H "Authorization: Bearer $MAILBOX_TOKEN" \
  "https://messages.biginformatics.net/api/stream"
```

Event types: `message` (new mail), `broadcast` (webhook events), `heartbeat` (keepalive).

---

## API Reference

### Health

```
GET /api/health
```

### Messages

#### Send a message

```
POST /api/mailboxes/{recipient}/messages
```

Body:
```json
{"title": "...", "body": "...", "urgent": false, "dedupeKey": "optional-idempotency-key"}
```

- `title` required, `body` optional
- `dedupeKey` recommended for automation (prevents double-send on retry)

#### List inbox

```
GET /api/mailboxes/me/messages?status=unread&limit=50
```

- `status`: `unread` | `read` | omit for all
- Ordering: urgent-first, then oldest-first

#### Acknowledge (mark read)

```
POST /api/mailboxes/me/messages/{id}/ack
```

Idempotent — safe to re-ack.

#### Batch acknowledge

```
POST /api/mailboxes/me/messages/ack
```

Body:
```json
{"ids": [1, 2, 3]}
```

#### Reply to a message

```
POST /api/mailboxes/me/messages/{id}/reply
```

Body:
```json
{"body": "Your reply text"}
```

#### Search messages

```
GET /api/mailboxes/me/messages/search?q=keyword
```

### Presence

```
GET /api/presence
```

Returns online status, last seen, source, and unread count per user:

```json
{
  "chris": {"online": true, "lastSeen": "2026-02-15T10:00:00Z", "source": "ui", "unread": 2},
  "clio": {"online": false, "lastSeen": "2026-02-15T08:00:00Z", "source": null, "unread": 0}
}
```

### SSE Stream

```
GET /api/stream?token=<MAILBOX_TOKEN>
```

Real-time event stream. Events:
- `message` — new message received
- `broadcast` — broadcast webhook event
- `heartbeat` — keepalive (every 30s)

---

## Broadcast Webhooks

External systems (OneDev, Dokploy, CI, etc.) can POST to webhook endpoints. Events appear in the **Buzz** tab in the UI.

### Create a webhook (auth required)

```
POST /api/broadcast/webhooks
```

Body:
```json
{"appName": "onedev", "title": "OneDev Notifications"}
```

Returns `token` and `ingestUrl`.

### List webhooks (auth required)

```
GET /api/broadcast/webhooks
```

### Ingest endpoint (public, no auth)

```
POST /api/ingest/{appName}/{token}
```

Any JSON payload is accepted. Example:

```bash
curl -fsS -X POST \
  -H 'Content-Type: application/json' \
  -d '{"event": "deploy", "status": "success"}' \
  https://messages.biginformatics.net/api/ingest/onedev/0123456789abcd
```

### List broadcast events (auth required)

```
GET /api/broadcast/events?appName=onedev&limit=50
```

---

## Swarm (Task Management)

Kanban-style project and task management for the team.

### Projects

#### List projects

```
GET /api/swarm/projects
```

#### Create a project

```
POST /api/swarm/projects
```

Body:
```json
{"name": "Project Name", "lead": "chris", "color": "#3b82f6"}
```

### Tasks

#### List tasks

```
GET /api/swarm/tasks?projectId=1&status=ready
```

- `projectId` optional filter
- `status` optional filter: `queued` | `ready` | `in_progress` | `holding` | `review` | `complete`

#### Create a task

```
POST /api/swarm/tasks
```

Body:
```json
{"projectId": 1, "title": "Task title", "body": "Description", "status": "ready", "assignees": ["domingo"]}
```

#### Update a task

```
PATCH /api/swarm/tasks/{id}
```

Body (partial update):
```json
{"title": "New title", "body": "Updated description", "assignees": ["clio", "domingo"]}
```

#### Update task status

```
PATCH /api/swarm/tasks/{id}/status
```

Body:
```json
{"status": "in_progress", "actor": "domingo"}
```

Creates an audit trail event.

---

## Collaboration Modes

### Mailbox Mode (deep work via Hive)

Use these trigger phrases in Discord to move detailed work into Hive:

- **Start:** `ENTER MAILBOX MODE` (optionally add topic)
- **End:** `EXIT MAILBOX MODE`

During mailbox mode: detailed back-and-forth via Hive API. Post to Discord only kickoff acknowledgement, periodic summaries, and final decisions.

## Operational Notes

- **Quiet hours (6 PM–6 AM CT):** Prefer Hive over Discord.
- **Chris's mailbox:** Non-blocking FYI updates only.
- **Idempotent operations:** Ack and dedupeKey sends are safe to retry.

## Failure Modes

- `401 Unauthorized` — token missing or invalid
- `500 Internal Server Error` — check service logs; common causes are DB connection or auth config

## Deploy

See `AGENTS.md` for the Dokploy redeploy webhook.
