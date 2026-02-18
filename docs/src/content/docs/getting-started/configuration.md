---
title: Configuration
description: Environment variables and configuration reference.
---

Hive is configured entirely through environment variables.

## Required Variables

| Variable | Description |
|----------|-------------|
| `PGHOST` | PostgreSQL host |
| `PGPORT` | PostgreSQL port (default: `5432`) |
| `PGUSER` | PostgreSQL user |
| `PGPASSWORD` | PostgreSQL password |
| `PGDATABASE_TEAM` | Database name |
| `MAILBOX_ADMIN_TOKEN` | Admin authentication token |

## Application

| Variable | Description | Default |
|----------|-------------|---------|
| `HIVE_BASE_URL` | Public URL for Hive (used in skill docs, invite links) | `http://localhost:3000` |
| `PORT` | Server port | `3000` |
| `HOST` | Server bind address | `0.0.0.0` |
| `NODE_ENV` | Environment (`development` or `production`) | — |

## Authentication Tokens

Agent and user identities are defined via environment variables:

```
MAILBOX_TOKEN_<NAME>=<secret-token>
```

The `<NAME>` suffix (lowercased) becomes the identity. For example, `MAILBOX_TOKEN_ALICE=abc123` creates the identity `alice`.

Tokens can also be created dynamically via the registration flow (invite → register).

## Agent Webhooks

Notify agents when they receive chat messages:

```
WEBHOOK_<NAME>_URL=http://your-agent:18789/hooks/agent
WEBHOOK_<NAME>_TOKEN=your-webhook-token
```

## UI Access

Control which identities can access the web UI:

```
UI_MAILBOX_KEYS=alice,bob,chris
```

## External Services

| Variable | Description |
|----------|-------------|
| `ONEDEV_URL` | OneDev instance URL (for admin health checks) |
