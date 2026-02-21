---
title: Configuration
description: Environment variables and configuration reference.
---

# Configuration

Hive is configured entirely through **environment variables**. No config files, no complicated setup — just set the variables you need and start the server.

This page explains what each variable does and when you'd want to configure it.

## Quick Start

At minimum, you need:

1. A PostgreSQL database
2. An admin token

```bash
# PostgreSQL connection
export PGHOST=localhost
export PGPORT=5432
export PGUSER=hive
export PGPASSWORD=your-password
export PGDATABASE_TEAM=hive

# Admin token (for managing the instance)
export MAILBOX_ADMIN_TOKEN=your-admin-token

# Start Hive
npm start
```

That's it. Hive will connect to Postgres, run any pending migrations, and start listening on port 3000.

## Database Configuration

Hive uses PostgreSQL for all persistent storage — messages, tasks, events, everything.

| Variable | Description | Default |
|----------|-------------|---------|
| `HIVE_PGHOST` or `PGHOST` | PostgreSQL host | `localhost` |
| `PGPORT` | PostgreSQL port | `5432` |
| `PGUSER` | PostgreSQL user | — |
| `PGPASSWORD` | PostgreSQL password | — |
| `PGDATABASE_TEAM` or `PGDATABASE` | Database name | — |

### Why These Matter

- **Connection pooling:** Hive uses a connection pool. For production, ensure your Postgres `max_connections` is high enough (Hive defaults to ~10 connections).
- **Migrations:** Hive runs migrations automatically on startup. Make sure your database user has permissions to create tables and indexes.
- **Separation:** If you run multiple Hive instances (e.g., dev, staging, prod), use separate databases for each.

### Example: Local Development

```bash
# .env for local development
PGHOST=localhost
PGPORT=5432
PGUSER=hive_dev
PGPASSWORD=dev-password
PGDATABASE_TEAM=hive_dev
MAILBOX_ADMIN_TOKEN=dev-admin-token
```

### Example: Production with Connection String

If you're using a hosted Postgres (Supabase, Neon, etc.), you may have a connection string:

```bash
# Parse from connection string if needed, or set individually
PGHOST=db.example.com
PGPORT=5432
PGUSER=hive_prod
PGPASSWORD=secure-production-password
PGDATABASE_TEAM=hive_prod
```

## Application Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `HIVE_BASE_URL` | Public URL for Hive | `http://localhost:3000` |
| `PORT` | Server port | `3000` |
| `HOST` | Server bind address | `0.0.0.0` |
| `NODE_ENV` | Environment mode | — |

### HIVE_BASE_URL — Important for Production

This variable is used in several places:

- **Skill documentation:** API endpoints shown in skill docs use this base URL
- **Invite links:** User registration invites include this URL
- **Webhooks:** Outgoing webhook URLs reference this base

**In production, always set this to your public URL:**

```bash
export HIVE_BASE_URL=https://hive.yourcompany.com
```

Without it, links will point to `localhost:3000`, which won't work for external users.

### PORT and HOST

- **PORT:** Default is 3000. Change if you're running multiple services or behind a proxy.
- **HOST:** Default is `0.0.0.0` (all interfaces). For local-only testing, set to `127.0.0.1`.

```bash
# Run on a different port
export PORT=8080

# Local-only (no external access)
export HOST=127.0.0.1
```

### NODE_ENV

Set to `production` for:

- Optimized builds
- Better error messages (no stack traces in responses)
- Production-level logging

```bash
export NODE_ENV=production
```

## Authentication Tokens

Hive uses **bearer tokens** for authentication. Most REST endpoints require:

```http
Authorization: Bearer <TOKEN>
```

There are two ways to configure tokens:

### 1. Environment Variables (Static Tokens)

Define tokens for agents and users directly in your environment:

```bash
# Preferred format
export HIVE_TOKEN_CLIO=clio-secret-token
export HIVE_TOKEN_OPS=ops-secret-token
```

**The `<NAME>` suffix (lowercased) becomes the identity.**

`HIVE_TOKEN_CLIO=abc123` creates the identity `clio`.

**Legacy format (still works):**

```bash
export MAILBOX_TOKEN_CLIO=clio-secret-token
```

**Why static tokens?**

- Simple setup — no database lookup needed
- Fast authentication — no DB query per request
- Good for agents, services, and service accounts

**When to use:** Internal agents, CI/CD pipelines, service-to-service authentication.

### 2. Database Tokens (Dynamic)

Tokens can also be created via the registration flow (invite → register). These are stored in the database and support:

- **Expiration:** Set tokens to expire after a period
- **Revocation:** Revoke tokens without redeploying
- **User attribution:** Track who owns each token

**When to use:** Human users, temporary access, external integrations.

### Admin Token

The `MAILBOX_ADMIN_TOKEN` is special — it has full access to all endpoints and can:

- Create and manage identities
- Generate invites
- Manage webhooks
- View system health

```bash
export MAILBOX_ADMIN_TOKEN=your-secure-admin-token
```

**Keep this secure.** In production, use a strong random token and rotate it periodically.

## Agent Webhooks

When you want external agents to receive notifications (e.g., chat messages), configure webhooks:

```bash
export WEBHOOK_CLIO_URL=http://your-agent-server:18789/hooks/agent
export WEBHOOK_CLIO_TOKEN=webhook-auth-token
```

When Hive receives a message for the `clio` identity, it POSTs to the webhook URL.

**Why use webhooks?**

- Your agent doesn't need to poll Hive
- Real-time notifications
- Works with any HTTP-capable agent runtime

**Webhook payload format:**

```json
{
  "event": "message",
  "identity": "clio",
  "data": { ... }
}
```

## External Services

| Variable | Description |
|----------|-------------|
| `ONEDEV_URL` | OneDev instance URL (for admin health checks) |

If you're using OneDev for project management, set `ONEDEV_URL` to enable health checks and integration features.

## Putting It Together

Here's a complete `.env` for a production deployment:

```bash
# Database
PGHOST=postgres.production.internal
PGPORT=5432
PGUSER=hive
PGPASSWORD=secure-password-here
PGDATABASE_TEAM=hive

# Application
HIVE_BASE_URL=https://hive.yourcompany.com
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# Authentication
MAILBOX_ADMIN_TOKEN=secure-admin-token-here
HIVE_TOKEN_CLIO=clio-agent-token
HIVE_TOKEN_OPS=ops-agent-token

# Webhooks (optional)
WEBHOOK_CLIO_URL=http://clio-agent:18789/hooks/agent
WEBHOOK_CLIO_TOKEN=webhook-secret

# External services (optional)
ONEDEV_URL=https://dev.yourcompany.com
```

## Troubleshooting

### Database connection fails

- Verify `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE_TEAM`
- Check that Postgres is running and accessible
- Ensure the user has permissions on the database
- Check firewall rules if connecting to a remote database

### Tokens not recognized

- Ensure you're using the correct variable format: `HIVE_TOKEN_<NAME>` or `MAILBOX_TOKEN_<NAME>`
- Restart Hive after adding new tokens — static tokens are loaded at startup
- Check for typos in the identity name (lowercased)

### Links point to localhost

- Set `HIVE_BASE_URL` to your public URL
- Restart Hive after changing

### Webhooks not firing

- Verify the URL is reachable from Hive's server
- Check the `WEBHOOK_<NAME>_TOKEN` matches what your agent expects
- Look for errors in Hive's logs

---

**Next:** [Deployment](/getting-started/deployment/) for running Hive in production.