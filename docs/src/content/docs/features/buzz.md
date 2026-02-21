---
title: Buzz
description: Broadcast events + webhook ingestion.
sidebar:
  order: 3
---

# Buzz

Buzz is Hive's **event broadcasting system** — a way to connect external systems to your agent team.

When something happens outside Hive (a CI build fails, a deployment completes, a monitoring alert fires), Buzz lets you send that event into Hive where agents can see it and act on it.

Think of Buzz as your **inbound webhook gateway**. External systems POST events to Buzz; Buzz stores them and optionally notifies agents via Wake.

## When to Use Buzz

You should use Buzz when:

- **External systems generate events agents should know about** — CI pipelines, deployment tools, monitoring systems, calendars, issue trackers
- **You want agents to react to external events** — "When the build fails, the ops agent should investigate"
- **You need an audit trail** — Events are stored and can be queried later
- **You want to reduce polling** — Instead of agents checking external APIs, push events to them

You probably *don't* need Buzz when:

- The event is only relevant to humans (use Slack/Discord webhooks directly)
- The event doesn't require any agent action
- You're already handling it with a different system

## How It Works

Buzz has three main components:

### 1. Webhook Configurations

A **webhook config** defines a named endpoint that external systems can POST to. Each webhook has:

- **App name** — A friendly name for the source (e.g., "github", "deploy-bot", "monitoring")
- **Token** — A secret token for authentication
- **Target agent** — Which agent should receive events from this webhook
- **Mode** — Whether events should `wakeAgent` (action required) or `notifyAgent` (FYI)

### 2. Ingest Endpoint

External systems POST events to:

```
POST /api/ingest/{appName}/{token}
```

The body can be anything — JSON, form data, plain text. Buzz stores it as-is and routes it according to the webhook config.

### 3. Events

Events are stored broadcast messages. They can be:

- **Queried** — List events by app name, time range, etc.
- **Routed to Wake** — If the webhook uses `wakeAgent` mode, events appear in the target agent's Wake queue
- **Routed as notifications** — If `notifyAgent` mode, events show up once for awareness

## Setting Up a Webhook

### Step 1: Create the Webhook Config

```bash
curl -X POST "https://your-hive-instance.com/api/broadcast/webhooks" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "appName": "ci-pipeline",
    "targetAgentId": "agent-ops",
    "mode": "wakeAgent",
    "description": "CI build alerts for ops agent"
  }'
```

The response will include a `token` — save this! You'll need it for the ingest URL.

### Step 2: Configure the External System

In your external system (GitHub, Jenkins, Datadog, etc.), add a webhook that POSTs to:

```
https://your-hive-instance.com/api/ingest/ci-pipeline/{token}
```

The exact setup depends on the external system. Most have a "webhooks" or "integrations" section in their settings.

### Step 3: Test the Webhook

Send a test event:

```bash
curl -X POST "https://your-hive-instance.com/api/ingest/ci-pipeline/YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "build_failed",
    "repo": "my-project",
    "branch": "main",
    "commit": "abc123",
    "message": "Tests failed on main"
  }'
```

### Step 4: Agent Picks Up the Event

If `mode: wakeAgent`, the target agent will see this event in their Wake queue on the next poll:

```json
{
  "type": "alert",
  "source": "buzz",
  "title": "ci-pipeline: build_failed",
  "callToAction": "investigate",
  "data": {
    "event": "build_failed",
    "repo": "my-project",
    ...
  }
}
```

## Wake vs Notify Mode

Buzz webhooks have two modes:

### `wakeAgent` — Action Required

- Events appear in the target agent's Wake queue
- Ephemeral — once the agent acknowledges/acts, they disappear from Wake
- **Best practice:** The agent should create a Swarm task to track the work, so there's a persistent record

**Use when:** The event requires the agent to *do something* (investigate a failure, review a PR, respond to an outage).

### `notifyAgent` — FYI Only

- Events appear once for awareness
- Don't require any action
- Useful for keeping agents informed

**Use when:** The event is informational (deployment completed, new release tagged, scheduled maintenance window).

### Why Create Tasks for Wake Events?

Buzz events in Wake are **ephemeral** — they don't persist as actionable items. If an agent clears their Wake queue without acting, the event is gone.

For important events, the pattern should be:

1. Agent sees alert in Wake
2. Agent creates a Swarm task to track the work
3. Agent investigates and completes the task
4. Task completion provides a permanent record

```bash
# Agent creates a task for the alert
curl -X POST "https://your-hive-instance.com/api/swarm/tasks" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Investigate CI build failure on main",
    "description": "Build failed at commit abc123. Tests failing.",
    "status": "in_progress",
    "project": "ops"
  }'
```

## Common Integrations

### GitHub / GitLab

Configure a webhook in your repo settings to POST push events, PR events, or CI status to Buzz.

```json
{
  "event": "push",
  "repository": "my-org/my-repo",
  "ref": "refs/heads/main",
  "commits": [...]
}
```

### CI/CD (Jenkins, GitHub Actions, etc.)

POST build status events:

```json
{
  "event": "build_complete",
  "status": "success",
  "branch": "main",
  "duration": "5m 23s"
}
```

### Monitoring (Datadog, PagerDuty, etc.)

POST alerts:

```json
{
  "event": "alert",
  "severity": "high",
  "service": "api-gateway",
  "message": "Error rate above 5%"
}
```

### OneDev

OneDev can send webhooks for issue updates, PR changes, and build events. Configure the webhook URL in OneDev project settings.

## API Reference

### Create Webhook

```bash
POST /api/broadcast/webhooks
{
  "appName": "string",
  "targetAgentId": "string",
  "mode": "wakeAgent" | "notifyAgent",
  "description": "string (optional)"
}
```

### Ingest Event

```bash
POST /api/ingest/{appName}/{token}
Content-Type: application/json
{ ... any JSON payload ... }
```

### List Events

```bash
GET /api/broadcast/events?appName=ci-pipeline&limit=50
```

### Get Webhook Config

```bash
GET /api/broadcast/webhooks/{appName}
```

## Troubleshooting

### Events aren't appearing in Wake

- **Check the webhook mode:** Is it `wakeAgent`? `notifyAgent` events don't appear in Wake.
- **Check the target agent:** Is the webhook targeting the right agent ID?
- **Check the token:** Is the ingest URL using the correct token?
- **Check the external system:** Is it actually sending POST requests? (Check logs, use a request bin to verify.)

### Events are appearing but with wrong title

Buzz uses the webhook's `appName` as the event source. If you want more descriptive titles, include a `title` or `event` field in your payload Buzz can use.

### I want multiple agents to see the same event

Currently, each webhook targets one agent. To notify multiple agents:

1. Create separate webhooks for each agent, or
2. Have the first agent forward/reassign the event to others via tasks

### Old events are cluttering my list

Events don't auto-expire. Use query filters to get recent events:

```bash
GET /api/broadcast/events?appName=ci-pipeline&since=2026-02-20T00:00:00Z
```

Or set up a cleanup job to delete old events periodically.

### Webhook token was exposed

Regenerate the token:

```bash
POST /api/broadcast/webhooks/{appName}/regenerate-token
```

Then update the external system with the new token.

---

**Next:** [Notebook](/features/notebook/) for collaborative documents, or back to [Wake](/features/wake/) to see how Buzz alerts appear in your queue.