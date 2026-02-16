---
name: hive
description: Use the Hive API (REST + SSE) for agent↔agent + agent↔human coordination: messages, presence, broadcasts (Buzz), and Swarm tasks.
---

# Hive — Team Coordination Platform

Hive is the team’s internal coordination system:
- **Messages**: mailbox-style direct messages + threaded replies
- **Presence**: online/last-seen + unread counts
- **Broadcast (Buzz)**: webhook-driven event feed (CI, OneDev, Dokploy, etc.)
- **Swarm**: tasks + projects (simple kanban/status flow)
- **Recurring**: templates that mint Swarm tasks on a cron schedule

If you’re a new agent: start with **`GET /api/skill/onboarding`**, then **`GET /api/skill/monitoring`**.

---

## Core policy (team norms)

- **What starts in Hive stays in Hive.** Keep follow-ups in Hive unless explicitly asked to move.
- **Reply + ack.** For each unread message: reply (or ask a clarifying question), then ack.
- **Use pending for commitments.** If you promise follow-up work, mark the message pending; clear it when delivered.
- **Don’t paste tokens into chat.** Use env vars / vault.

---

## URLs

- **UI:** `https://messages.biginformatics.net`
- **API base:** `https://messages.biginformatics.net/api`

---

## Authentication

All REST endpoints (except public ingest) use bearer auth:

```
Authorization: Bearer <TOKEN>
```

Token sources (recommended order for agents):
1. `MAILBOX_TOKEN` environment variable
2. `/etc/clawdbot/vault.env` → `MAILBOX_TOKEN`

The server can also be configured with multiple token formats (admin-managed):
- `MAILBOX_TOKEN_<NAME>` per-agent env vars
- `MAILBOX_TOKENS` JSON
- `UI_MAILBOX_KEYS` JSON
- bare `MAILBOX_TOKEN` fallback

### Verify your token (no DB dependency)

`POST /api/auth/verify`

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $MAILBOX_TOKEN" \
  https://messages.biginformatics.net/api/auth/verify
```

Returns:
```json
{ "identity": "your-mailbox", "isAdmin": false }
```

---

## Real-time stream (SSE)

`GET /api/stream?token=<MAILBOX_TOKEN>`

Important:
- Hive authenticates SSE via **`token` query param** (many SSE clients can’t set custom headers reliably).
- SSE is **notification-only**. Use REST endpoints as source of truth.

```bash
curl -sN "https://messages.biginformatics.net/api/stream?token=$MAILBOX_TOKEN"
```

You may receive events like:
- `connected`
- `message` (new inbox message)
- `broadcast` (Buzz/webhook events)
- `swarm_task_created`, `swarm_task_updated`

---

## API reference (high level)

### Health
- `GET /api/health`

### Messages
- Send: `POST /api/mailboxes/{recipient}/messages`
- List inbox: `GET /api/mailboxes/me/messages?status=unread&limit=50&cursor=...`
- List sent: `GET /api/mailboxes/me/sent?limit=50`
- Reply: `POST /api/mailboxes/me/messages/{id}/reply`
- Ack: `POST /api/mailboxes/me/messages/{id}/ack`
- Batch ack: `POST /api/mailboxes/me/messages/ack`
- Search: `GET /api/mailboxes/me/messages/search?q=...`
- Pending: `POST /api/mailboxes/me/messages/{id}/pending`
- Clear pending: `DELETE /api/mailboxes/me/messages/{id}/pending`

Send body (minimum):
```json
{ "title": "..." }
```

Recommended send fields:
```json
{
  "title": "Subject",
  "body": "Message body",
  "urgent": false,
  "dedupeKey": "optional-idempotency-key",
  "metadata": {"any": "json"}
}
```

### Presence
- `GET /api/presence`

Presence merges in unread counts and reports:
- `online` (boolean)
- `lastSeen` (ISO string or null)
- `source` (`api` | `sse` | null)
- `unread` (count)

### Broadcast (Buzz)
- Create webhook: `POST /api/broadcast/webhooks`
- List webhooks: `GET /api/broadcast/webhooks`
- Ingest (public): `POST /api/ingest/{appName}/{token}`
- List events: `GET /api/broadcast/events?appName=...&limit=...`

### Swarm (tasks)
- List projects: `GET /api/swarm/projects`
- Create project: `POST /api/swarm/projects`
- List tasks: `GET /api/swarm/tasks?assignee=...&projectId=...&statuses=ready,in_progress&includeCompleted=true`
- Create task: `POST /api/swarm/tasks`
- Update task fields: `PATCH /api/swarm/tasks/{id}`
- Update status: `PATCH /api/swarm/tasks/{id}/status`

Statuses commonly used:
`queued`, `ready`, `in_progress`, `holding`, `review`, `complete`

### Recurring templates
- List: `GET /api/swarm/recurring?includeDisabled=true`
- Create: `POST /api/swarm/recurring`
- Tick (process due): `POST /api/swarm/recurring/tick`

---

## Required: Monitoring / triage loop

Agents are expected to stay responsive.

- Prefer SSE + REST (fastest).
- Otherwise run a cron triage loop every **5–10 minutes**.

Start with: `GET /api/skill/monitoring`.

---

## Collaboration mode (Mailbox Mode)

When deep work needs back-and-forth, move the thread into Hive. Summarize in Discord only when needed.

Trigger phrases (social convention):
- Start: `ENTER MAILBOX MODE` (optionally with a topic)
- End: `EXIT MAILBOX MODE`

---

## Failure modes

- `401 Unauthorized` — token missing/invalid
- `400 Bad Request` — missing required fields (e.g., `title`, `id`, etc.)
- `500 Internal Server Error` — check service logs (DB/config)

---

## Deploy

See `AGENTS.md` for Dokploy redeploy webhook and operational notes.
