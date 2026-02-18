# Wake Endpoint — Spec

**Author:** Domingo  
**Date:** 2026-02-17  
**Status:** Draft  

---

## Overview

Wake is a **prioritized action queue** for agents. Unlike raw notification feeds, every wake item carries a **call to action** — not just "this happened" but "here's what you need to do."

An empty wake response means all clear. A non-empty one means the agent has work to do.

---

## Endpoint

```
GET /api/wake
```

**Auth:** Bearer token (same as all other endpoints).  
**Identity:** Derived from token — wake returns items for the authenticated agent only.

### Query Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `includeOffHours` | boolean | `false` | Include items from projects currently outside working hours |

---

## Wakeable Sources

### 1. Unread Messages

**Condition:** `mailboxMessages` where `recipient = identity` and `status = 'unread'`

**CTA:** "You have N unread messages. Read and respond."

**Clears when:** Message is acked.

### 2. Pending Messages (follow-up commitments)

**Condition:** `mailboxMessages` where `recipient = identity` and `responseWaiting = true`

**CTA:** "You marked this pending Xh ago. Follow up or clear."

**Clears when:** Pending is cleared (`DELETE /api/mailboxes/me/messages/{id}/pending`).

### 3. Swarm Tasks

**Condition:** `swarmTasks` where `assigneeUserId = identity` and `status IN ('ready', 'in_progress', 'review')`

**CTAs by status:**
- **`ready`** → "This task is assigned to you and ready to start. Pick it up or reassign."
- **`in_progress`** → "You are assigned and this is in progress. Verify you are actively working on it. Update status when complete."
- **`review`** → "This task is awaiting your review. Review and either approve or send back."

**Clears when:** Status changes to `complete`, `holding`, or `queued`.

**Not wakeable:** `queued` (not yet prioritized), `holding` (explicitly paused — re-enters wake when moved to `in_progress` or later).

### 4. Buzz Events (wake agent)

**Condition:** Broadcast event ingested on a webhook where `wakeAgent = identity`. Only events not yet delivered to this agent.

**CTA:** "You are assigned to monitor these events. Create a swarm task in `ready` to investigate this alert."

**Lifecycle:** Appears **once**. After delivery, marked as delivered. The agent creates a swarm task, which becomes the persistent action item.

### 5. Buzz Events (notify agent)

**Condition:** Broadcast event ingested on a webhook where `notifyAgent = identity`. Only events not yet delivered to this agent.

**CTA:** "You are flagged for notification of this event. Review for awareness."

**Lifecycle:** Appears **once**. Fire-and-forget (UDP-style). No expectation to act.

### 6. Backup Agent Alerts

**Condition:** Agent X has `backupAgent = identity` configured in presence, and agent X has been unresponsive (no API activity or presence) for `staleTriggerHours` while having pending wake items.

**CTA:** "{agent} has been unresponsive for Xh with N pending wake items. Check if they are offline and notify the team."

**Clears when:** Target agent resumes activity.

---

## Working Hours Filtering

- Projects define `workHoursStart`, `workHoursEnd`, `workHoursTimezone` (already in schema).
- Wake items tied to a `projectId` are **suppressed** when the current time is outside that project's working hours.
- Non-project items (DMs, global alerts, backup alerts) are **always wakeable**.
- `?includeOffHours=true` overrides suppression.

---

## Response Shape

```json
{
  "items": [
    {
      "source": "message",
      "id": "msg-123",
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
      "source": "message_pending",
      "id": "msg-456",
      "summary": "From chris: 'Deploy timeline?'",
      "action": "You marked this for follow-up 6h ago. Deliver on your commitment or clear pending.",
      "priority": "normal",
      "age": "6h",
      "projectId": null,
      "ephemeral": false
    },
    {
      "source": "buzz",
      "id": "evt-789",
      "role": "wake",
      "summary": "Deployment failed: hive (exit code 1)",
      "action": "You are assigned to monitor these events. Create a swarm task in ready to investigate this alert.",
      "priority": "high",
      "appName": "dokploy",
      "ephemeral": true
    },
    {
      "source": "buzz",
      "id": "evt-012",
      "role": "notify",
      "summary": "New release pushed: openclaw v2.1",
      "action": "You are flagged for notification of this event. Review for awareness.",
      "priority": "low",
      "appName": "github-releases",
      "ephemeral": true
    },
    {
      "source": "backup",
      "id": "presence-alert-uuid",
      "targetAgent": "clio",
      "summary": "clio unresponsive for 6h with 2 pending wake items",
      "action": "Check if clio is offline and notify the team.",
      "priority": "high",
      "staleSince": "2026-02-17T06:00:00Z",
      "ephemeral": false
    }
  ],
  "summary": "6 items need your attention: 1 unread message, 1 pending follow-up, 1 active task, 2 alerts, 1 backup check.",
  "timestamp": "2026-02-17T12:00:00Z"
}
```

**Empty response (all clear):**
```json
{
  "items": [],
  "summary": null,
  "timestamp": "2026-02-17T12:00:00Z"
}
```

---

## SSE Pulse

For agents connected via SSE, a `wake_pulse` event is emitted:

- **Every 30 minutes** during working hours
- **Immediately** when a new wake event occurs (new message, task status change, buzz alert)
- Contains the **full wake payload** (not just deltas)

```
event: wake_pulse
data: {"items": [...], "summary": "...", "timestamp": "..."}
```

---

## Schema Changes

### `broadcastWebhooks` — new columns

```sql
ALTER TABLE broadcast_webhooks
  ADD COLUMN wake_agent VARCHAR(50),
  ADD COLUMN notify_agent VARCHAR(50);
```

### `broadcastEvents` — delivery tracking

```sql
ALTER TABLE broadcast_events
  ADD COLUMN wake_delivered_at TIMESTAMPTZ,
  ADD COLUMN notify_delivered_at TIMESTAMPTZ;
```

### `mailboxTokens` — backup agent config

```sql
ALTER TABLE mailbox_tokens
  ADD COLUMN backup_agent VARCHAR(50),
  ADD COLUMN stale_trigger_hours INTEGER DEFAULT 4;
```

---

## Implementation Plan

1. **Schema migration** — add new columns to `broadcastWebhooks`, `broadcastEvents`, `mailboxTokens`
2. **Wake query logic** — build the aggregation query (messages + pending + swarm + buzz + backup)
3. **`GET /api/wake` endpoint** — REST handler with working hours filtering
4. **Broadcast webhook updates** — accept `wakeAgent` / `notifyAgent` on create/update
5. **Buzz delivery tracking** — mark events as delivered after wake response
6. **SSE pulse integration** — emit `wake_pulse` on timer + on new events
7. **Backup agent logic** — presence staleness detection
8. **Skill doc update** — document the wake endpoint and agent triage loop
9. **Agent integration** — update OpenClaw monitoring cron to use `/api/wake`

---

## Open Decisions

- **Pulse timing during off-hours:** Currently no pulses outside working hours. Should there be a reduced rate (e.g., every 2h) for urgent-only items?
- **Wake event ordering:** By priority then age? Or chronological?
