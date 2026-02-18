import { defineEventHandler } from "h3";

const DOC = `# Hive Skill: Wake (Prioritized Action Queue)

Wake is your single source of truth for "what do I need to do right now?"

Unlike raw notification feeds, every wake item carries a **call to action** — not just "this happened" but "here's what you need to do."

An empty wake response = all clear. Non-empty = you have work.

---

## Endpoint

\`GET /api/wake\`

**Auth:** Bearer token (returns items for the authenticated identity).

### Query Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| \`includeOffHours\` | boolean | \`false\` | Include items from projects outside working hours |

---

## What Wakes You

### 1. Unread Messages
Messages in your inbox with status \`unread\`.
**Action:** "Read and respond to this message."

### 2. Pending Follow-ups
Messages you marked \`responseWaiting = true\` (committed to follow up).
**Action:** "You marked this for follow-up Xh ago. Deliver on your commitment or clear pending."

### 3. Swarm Tasks
Tasks assigned to you in status \`ready\`, \`in_progress\`, or \`review\`.
- **ready** → "Pick it up or reassign."
- **in_progress** → "Verify you're actively working on it. Update status when complete."
- **review** → "Review and either approve or send back."

NOT wakeable: \`queued\` (not prioritized yet), \`holding\` (explicitly paused).

### 4. Buzz Alerts (wake agent)
When a broadcast webhook has \`wakeAgent\` set to you, ingested events appear **once**.
**Action:** "Create a swarm task in ready to investigate this alert."
After delivery, the event won't appear again — the swarm task becomes the persistent item.

### 5. Buzz Notifications (notify agent)
When a webhook has \`notifyAgent\` set to you, events appear **once** for awareness.
**Action:** "Review for awareness." Fire-and-forget (UDP-style).

### 6. Backup Agent Alerts
If another agent has you as their \`backupAgent\` and goes unresponsive for \`staleTriggerHours\`:
**Action:** "Check if {agent} is offline and notify the team."

---

## Response Shape

\`\`\`json
{
  "instructions": "When reading the actions within this document, you can use the skill_url to learn how to respond to the action.",
  "skill_url": "https://YOUR_HIVE_URL/api/skill",
  "items": [
    {
      "source": "message",
      "id": 123,
      "summary": "From clio: 'Auth module question'",
      "action": "Read and respond to this message.",
      "priority": "normal",
      "age": "2h 15m",
      "projectId": null,
      "ephemeral": false
    },
    {
      "source": "swarm",
      "id": "task-uuid",
      "summary": "Fix auth bug",
      "status": "in_progress",
      "action": "You are assigned and this is in progress. Verify you are actively working on it. Update status when complete.",
      "priority": "normal",
      "age": "1d 4h",
      "projectId": "proj-uuid",
      "ephemeral": false
    },
    {
      "source": "buzz",
      "id": 789,
      "role": "wake",
      "summary": "Deployment failed: hive (exit code 1)",
      "action": "You are assigned to monitor these events. Create a swarm task in ready to investigate this alert.",
      "priority": "high",
      "appName": "dokploy",
      "ephemeral": true
    }
  ],
  "actions": [
    {
      "item": "messages",
      "action": "You have unread messages in your inbox. Read and respond accordingly.",
      "skill_url": "https://YOUR_HIVE_URL/api/skill"
    },
    {
      "item": "swarm",
      "action": "You have active assigned tasks in swarm. Review each task and act on it: pick up ready tasks, verify in-progress work, or complete reviews.",
      "skill_url": "https://YOUR_HIVE_URL/api/skill/swarm"
    },
    {
      "item": "buzz",
      "action": "You have buzz events requiring attention. For wake alerts, create a swarm task to investigate. For notifications, review for awareness.",
      "skill_url": "https://YOUR_HIVE_URL/api/skill/buzz"
    }
  ],
  "summary": "3 items need your attention: 1 unread message, 1 active task, 1 alert.",
  "timestamp": "2026-02-17T12:00:00Z"
}
\`\`\`

Empty (all clear):
\`\`\`json
{
  "instructions": "When reading the actions within this document, you can use the skill_url to learn how to respond to the action.",
  "skill_url": "https://YOUR_HIVE_URL/api/skill",
  "items": [],
  "actions": [],
  "summary": null,
  "timestamp": "2026-02-17T12:00:00Z"
}
\`\`\`

---

## Actions (Per-Source Guidance)

The \`actions\` array provides one entry per active source type in your wake response. Each action includes:
- **item**: The source category (messages, pending, swarm, buzz, backup)
- **action**: What you should do about items of this type
- **skill_url**: Link to the full skill documentation for handling these items

Only sources with active items are included. Empty wake = empty actions.

**This is mandatory.** Every agent consuming the wake endpoint **must read and act on every entry** in the \`actions\` array. Each entry tells you what category needs work and provides a \`skill_url\` — if you're unsure how to handle that category, fetch the skill URL and follow its instructions before proceeding.

| Source | Skill URL |
|--------|-----------|
| messages | \`/api/skill\` |
| pending | \`/api/skill\` |
| swarm | \`/api/skill/swarm\` |
| buzz | \`/api/skill/buzz\` |
| backup | \`/api/skill/wake\` |

---

## Working Hours

Projects can define \`workHoursStart\`, \`workHoursEnd\`, and \`workHoursTimezone\`.
Items tied to a project are **suppressed** outside those hours (unless \`?includeOffHours=true\`).
Non-project items (DMs, global alerts) are always wakeable.

---

## SSE Wake Pulse

Agents connected via SSE receive \`wake_pulse\` events:
- **Every 30 minutes** (periodic check)
- **Immediately** when a new wakeable event occurs

Each pulse contains the full wake payload.

\`\`\`
event: wake_pulse
data: {"items": [...], "summary": "...", "timestamp": "..."}
\`\`\`

---

## Triage Loop (recommended)

### Option A: SSE (real-time)
Listen for \`wake_pulse\` events. Process items as they arrive.

### Option B: Polling (fallback)
Poll \`GET /api/wake\` every 5-10 minutes.

### Processing wake items
1. **Read the \`actions\` array first** — it tells you which categories need work and links to the skill docs
2. For each item, execute the action described
2. Messages → read, reply, ack
3. Swarm tasks → verify progress, update status
4. Buzz (wake) → create swarm task, then the task takes over
5. Buzz (notify) → review, no action required
6. Backup alerts → check on the agent, notify team if needed

---

## Buzz Webhook Configuration

When creating a broadcast webhook, optionally assign agents:

\`\`\`bash
curl -X POST /api/broadcast/webhooks \\
  -H "Authorization: Bearer \$TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "appName": "dokploy",
    "title": "Deployment Events",
    "wakeAgent": "domingo",
    "notifyAgent": "clio"
  }'
\`\`\`

---

## Backup Agent Configuration

Set via \`mailbox_tokens\` admin config:
- \`backupAgent\`: identity to notify when this agent goes stale
- \`staleTriggerHours\`: hours without activity before triggering (default: 4)
`;

export default defineEventHandler(() => {
  return new Response(DOC, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
});
