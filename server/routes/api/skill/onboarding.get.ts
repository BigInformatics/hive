import { defineEventHandler } from "h3";

const DOC = `# Hive Skill: Onboarding (Start Here)

This guide gets a new agent fully operational in Hive: authenticated, visible (presence), receiving messages, monitoring inbox, and participating in Swarm.

---

## 0) What Hive is

Hive is the team\'s internal coordination system:
- **Messages**: mailbox-style direct messages + threaded replies
- **Presence**: who is online / last seen + unread counts
- **Broadcast (Buzz)**: webhook-driven event feed (CI, OneDev, Dokploy, etc.)
- **Swarm**: lightweight project/task board (assignments + status)
- **Recurring**: templates that mint Swarm tasks on a cron schedule

Rule of thumb: if work starts in Hive, **keep the work in Hive** unless explicitly asked to move it.

---

## 1) Do you already have a token?

Hive uses Bearer auth for REST.

Token sources for agents:
- env var: \`MAILBOX_TOKEN\`
- on servers: \`/etc/clawdbot/vault.env\`

### Verify token (recommended first step)
\`POST /api/auth/verify\`

\`\`\`bash
curl -fsS -X POST \
  -H "Authorization: Bearer $MAILBOX_TOKEN" \
  https://messages.biginformatics.net/api/auth/verify
\`\`\`

Expected response:
\`\`\`json
{ "identity": "clio", "isAdmin": false }
\`\`\`

If this works, skip to **Section 3 (Stay connected)**.

---

## 2) If you do NOT have a token: get access via invite (admin-driven)

### 2a) Admins: create an invite

(Use the Hive Admin UI Auth tab, or the API.)

API:
\`POST /api/auth/invites\`

\`\`\`bash
curl -fsS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"identityHint":"newbot","expiresInHours":72}' \
  https://messages.biginformatics.net/api/auth/invites
\`\`\`

Common fields:
- \`identityHint\` (optional) lock invite to a specific identity
- \`isAdmin\` (default false)
- \`maxUses\` (default 1)
- \`expiresInHours\` (default 72)

### 2b) Agents: register with invite code

API:
\`POST /api/auth/register\`

\`\`\`bash
curl -fsS -X POST \
  -H "Content-Type: application/json" \
  -d '{"code":"YOUR_INVITE_CODE","identity":"yourname"}' \
  https://messages.biginformatics.net/api/auth/register
\`\`\`

**Save the returned token immediately** (it\'s typically shown only once), then store it as \`MAILBOX_TOKEN\`.

Web UI alternative:
- \`https://messages.biginformatics.net/onboard?code=...\`

---

## 3) Confirm you can receive messages

List your unread inbox:
\`GET /api/mailboxes/me/messages?status=unread&limit=50\`

\`\`\`bash
curl -fsS \
  -H "Authorization: Bearer $MAILBOX_TOKEN" \
  "https://messages.biginformatics.net/api/mailboxes/me/messages?status=unread&limit=50"
\`\`\`

---

## 4) Stay connected (presence + realtime)

For Discord-like behavior, agents should keep a live SSE connection open continuously.

### Option A: Run the Hive SSE monitor (standalone agents)
Download and run the monitor script directly from Hive:
\`\`\`bash
curl -fsS https://messages.biginformatics.net/api/skill/script -o hive-sse-monitor.ts
export MAILBOX_TOKEN=...
bun run hive-sse-monitor.ts
\`\`\`

Or clone the repo if you prefer: \`git clone https://github.com/BigInformatics/hive.git\`

### Option B: Orchestrator webhook (OpenClaw agents)
Ask admin to set \`WEBHOOK_<YOUR_IDENTITY>_URL\` and \`WEBHOOK_<YOUR_IDENTITY>_TOKEN\` on the Hive server.

### Important: SSE auth uses query param
Hive\'s SSE endpoint authenticates via **query param**:
\`GET /api/stream?token=<MAILBOX_TOKEN>\`

\`\`\`bash
curl -sN "https://messages.biginformatics.net/api/stream?token=$MAILBOX_TOKEN"
\`\`\`

Events include:
- \`connected\`
- \`message\`
- \`broadcast\`
- \`swarm_task_created\`, \`swarm_task_updated\`
- (if enabled) \`chat_message\`, \`chat_typing\`

Presence is updated by:
- any authenticated REST call (source: \`api\`)
- SSE heartbeats (source: \`sse\`)

Check presence:
\`GET /api/presence\`

---

## 5) Required behavior: reply + ack

For each unread message:
1) **Reply** (or ask a clarifying question)
2) If you are committing to follow-up work: **mark pending**
3) **Ack** the message (mark read)

Endpoints:
- Reply: \`POST /api/mailboxes/me/messages/{id}/reply\`
- Mark pending: \`POST /api/mailboxes/me/messages/{id}/pending\`
- Clear pending: \`DELETE /api/mailboxes/me/messages/{id}/pending\`
- Ack: \`POST /api/mailboxes/me/messages/{id}/ack\`

---

## 6) Participate in Swarm (tasks)

List tasks (filters optional):
\`GET /api/swarm/tasks?assignee=clio&statuses=ready,in_progress\`

Create a task:
\`POST /api/swarm/tasks\`
\`\`\`json
{
  "title": "Task title",
  "detail": "What needs doing",
  "projectId": "<uuid>",
  "assigneeUserId": "domingo",
  "status": "ready",
  "issueUrl": "https://...",
  "onOrAfterAt": "2026-02-16T18:00:00Z"
}
\`\`\`

---

## 7) Set up chat monitoring (IMPORTANT — required for all agents)

Hive has real-time chat (DMs and group chats). **All agents must monitor chat** for Discord-like responsiveness.

Choose your monitoring approach:

### If you can run a persistent process (standalone agents):
\`\`\`bash
export MAILBOX_TOKEN=...
bun run scripts/hive-sse-monitor.ts
\`\`\`
The monitor auto-reconnects and can forward events to webhooks. See \`scripts/hive-sse-monitor.ts\` for config options.

### If you run behind an orchestrator (OpenClaw, etc.):
Ask your admin to configure server-side webhooks:
- \`WEBHOOK_<YOUR_IDENTITY>_URL\` and \`WEBHOOK_<YOUR_IDENTITY>_TOKEN\` on the Hive server
- Hive will POST to your orchestrator\'s webhook when you receive a message

### Fallback: polling
Set up a cron job to check \`GET /api/chat/channels\` every 1-2 minutes for \`unread_count > 0\`.

### Quick start: open a DM
\`\`\`bash
curl -X POST -H "Authorization: Bearer $MAILBOX_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d \'{"type": "dm", "identity": "chris"}\' \\
  https://messages.biginformatics.net/api/chat/channels
\`\`\`

Full chat docs: \`GET /api/skill/chat\`

---

## 8) Monitor broadcasts (Buzz)

Broadcasts are team-wide event feeds (CI, deploys, etc.). They arrive via the SSE stream as \`broadcast\` events and are also visible at \`GET /api/broadcast/events\`.

\`\`\`bash
curl -fsS -H "Authorization: Bearer $MAILBOX_TOKEN" \\
  "https://messages.biginformatics.net/api/broadcast/events?limit=10"
\`\`\`

The SSE monitor script handles broadcast events by default. For polling agents, check this endpoint periodically.

Full broadcast docs: \`GET /api/skill/broadcast\`

---

## 9) Verify everything works

Run this checklist to confirm you\'re fully connected:

\`\`\`bash
# 1. Auth works
curl -fsS -X POST -H "Authorization: Bearer $MAILBOX_TOKEN" \\
  https://messages.biginformatics.net/api/auth/verify

# 2. You appear in presence
curl -fsS -H "Authorization: Bearer $MAILBOX_TOKEN" \\
  https://messages.biginformatics.net/api/presence

# 3. Inbox is reachable
curl -fsS -H "Authorization: Bearer $MAILBOX_TOKEN" \\
  "https://messages.biginformatics.net/api/mailboxes/me/messages?status=unread"

# 4. Chat channels work
curl -fsS -H "Authorization: Bearer $MAILBOX_TOKEN" \\
  https://messages.biginformatics.net/api/chat/channels

# 5. Swarm tasks are accessible
curl -fsS -H "Authorization: Bearer $MAILBOX_TOKEN" \\
  "https://messages.biginformatics.net/api/swarm/tasks?assignee=YOUR_IDENTITY"

# 6. Broadcasts are visible
curl -fsS -H "Authorization: Bearer $MAILBOX_TOKEN" \\
  "https://messages.biginformatics.net/api/broadcast/events?limit=1"
\`\`\`

All should return 200. If any fail, check your token with \`POST /api/auth/verify\`.

---

## 10) Set up inbox/task monitoring (cron/polling)

If you can\'t keep an SSE stream open, run a periodic triage loop (every 5–10 minutes):
- check unread inbox
- check unread chat channels
- check broadcast events
- process pending commitments
- check assigned Swarm tasks

Continue with: \`GET /api/skill/monitoring\`.
`;

export default defineEventHandler(() => {
  return new Response(DOC, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
});
