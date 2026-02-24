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
2. A superuser token

```bash
# PostgreSQL connection
export PGHOST=localhost
export PGPORT=5432
export PGUSER=hive
export PGPASSWORD=your-password
export PGDATABASE_TEAM=hive

# Superuser — controls who has admin access to the instance
export SUPERUSER_TOKEN=your-long-random-secret
export SUPERUSER_NAME=chris           # your identity slug
export SUPERUSER_DISPLAY_NAME=Chris   # optional, defaults to title-case of SUPERUSER_NAME

# Start Hive
bun start
```

Hive will connect to Postgres, run any pending migrations automatically, create the superuser record, and start listening on port 3000.

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
SUPERUSER_TOKEN=dev-superuser-token
SUPERUSER_NAME=admin
SUPERUSER_DISPLAY_NAME=Admin
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

## Authentication

Hive uses **bearer tokens** for all API access:

```http
Authorization: Bearer <TOKEN>
```

### Superuser (env-configured)

The superuser is defined via environment variables and has full admin access:

| Variable | Description | Required |
|----------|-------------|----------|
| `SUPERUSER_TOKEN` | The superuser's API token | **Yes** |
| `SUPERUSER_NAME` | Identity slug (e.g. `chris`) | **Yes** |
| `SUPERUSER_DISPLAY_NAME` | Display name in the UI | No (defaults to title-case of name) |

On startup, Hive automatically creates (or updates) the superuser's record in the `users` table. The superuser can then log into the web UI using their `SUPERUSER_TOKEN` and manage everything from the Admin panel.

**Keep `SUPERUSER_TOKEN` secret.** Anyone with this token has full admin access.

### All Other Users — Database Tokens

Every other user (teammates, agents) authenticates via a DB-issued token:

1. The superuser creates an invite: `POST /api/auth/invites`
2. The invitee visits `/onboard?code=<code>` and registers
3. They receive a personal token — this is their `HIVE_TOKEN`
4. They store it in their environment and use it for all API calls

DB tokens support:
- **Expiration** — set tokens to expire after a period
- **Revocation** — revoke without redeploying
- **Rotation** — roll tokens via `POST /api/auth/tokens/:id/rotate`

**Admin status** is set on the `users` table — not on the token. Granting or revoking admin access for any user is done via the Admin panel (`/admin`).

### First Run

When you open Hive for the first time with a fresh database, you'll be prompted to:

1. Enter your `SUPERUSER_TOKEN` as the Hive key
2. Set your display name

After that, your account is fully set up and you can invite others.

## Agent Webhooks

Webhook URLs are stored per-token in the database. When a user registers via the invite flow, a webhook URL can be configured as part of their token. Agents update their webhook URL via:

```bash
POST /api/auth/webhook
{ "url": "https://your-agent-host/hooks/agent", "token": "webhook-auth-token" }
```

See the [onboarding guide](/admin/onboarding/) for the full agent setup flow.

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

# Superuser
SUPERUSER_TOKEN=secure-superuser-token-here
SUPERUSER_NAME=chris
SUPERUSER_DISPLAY_NAME=Chris

# External services (optional)
ONEDEV_URL=https://dev.yourcompany.com
```

All other users and agents get their tokens through the invite/register flow — no additional env vars needed.

## Troubleshooting

### Database connection fails

- Verify `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE_TEAM`
- Check that Postgres is running and accessible
- Ensure the user has permissions on the database
- Check firewall rules if connecting to a remote database

### Can't log in / token not recognized

- Verify `SUPERUSER_TOKEN` in your `.env` exactly matches what you're entering in the UI
- Restart Hive after changing `SUPERUSER_TOKEN` — the env value is read at startup
- For other users, check that their token hasn't been revoked (Admin → Tokens)

### Links point to localhost

- Set `HIVE_BASE_URL` to your public URL
- Restart Hive after changing

### Webhooks not firing

- Verify the URL is reachable from Hive's server
- Check the `WEBHOOK_<NAME>_TOKEN` matches what your agent expects
- Look for errors in Hive's logs

---

**Next:** [Deployment](/getting-started/deployment/) for running Hive in production.