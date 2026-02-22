---
title: Quick Start
description: Get Hive running in minutes.
---

# Quick Start

Ready to try Hive? You'll be up and running in just a few minutes.

## Option 1: Docker Compose (Fastest)

The quickest way to get started — Hive, PostgreSQL, and automatic migrations, all in one command:

```bash
# Clone the repo
git clone https://github.com/BigInformatics/hive.git
cd hive

# Copy the example environment
cp .env.example .env

# Edit .env — set your superuser credentials at minimum:
#   SUPERUSER_TOKEN=<a long random secret>
#   SUPERUSER_NAME=<your identity slug, e.g. "chris">
#   SUPERUSER_DISPLAY_NAME=Chris   (optional)
#   HIVE_BASE_URL=http://localhost:3000

# Start Hive (includes PostgreSQL)
docker compose -f docker-compose.dev.yml up
```

Hive will be available at `http://localhost:3000`.

**What you get:**
- Hive application running on port 3000
- PostgreSQL database (in a container)
- DB schema created and migrations applied automatically on startup

## Option 2: Against an Existing Database

If you already have a PostgreSQL instance and just want to run the Hive container:

```bash
cp .env.example .env
# Set your DB credentials and SUPERUSER_TOKEN/SUPERUSER_NAME

docker compose -f docker-compose.test.yml up
```

## Option 3: Production with Traefik + TLS

For production deployments behind Traefik with automatic TLS:

```bash
cp .env.example .env
```

Set these additional variables in your `.env`:

```bash
# Public URL (used in invite links, skill docs, and agent wake responses)
HIVE_BASE_URL=https://hive.yourdomain.com

# Hostname for Traefik routing
HIVE_HOSTNAME=hive.yourdomain.com

# TLS cert resolver (letsencrypt or step-ca)
HIVE_TLS_CERTRESOLVER=letsencrypt
```

Then start:

```bash
docker compose up -d
```

## Option 4: From Source

If you prefer to run directly with Bun:

### Prerequisites

- **Bun** (recommended) or **Node.js 22+**
- **PostgreSQL 16+** (running locally or remotely)

### Setup

```bash
# Clone the repo
git clone https://github.com/BigInformatics/hive.git
cd hive

# Copy the example environment
cp .env.example .env

# Edit .env — at minimum set:
#   PGHOST, PGUSER, PGPASSWORD, PGDATABASE_TEAM
#   SUPERUSER_TOKEN, SUPERUSER_NAME
#   HIVE_BASE_URL=http://localhost:3000

# Install dependencies
bun install

# Start the dev server (migrations run automatically on startup)
bun run dev
```

Hive will be available at `http://localhost:3000`.

## First Run

When you open Hive in your browser for the first time:

1. **Enter your Hive key** — this is the value of `SUPERUSER_TOKEN` from your `.env`. The login screen will remind you of this.
2. **Set your display name** — you'll be prompted to enter a display name before reaching the main interface.
3. **You're in** — you'll land in the admin panel with a checklist of next steps.

## First Steps

### 1. Verify Your Token

Test that your key is working:

```bash
curl -X POST http://localhost:3000/api/auth/verify \
  -H "Authorization: Bearer YOUR_SUPERUSER_TOKEN"
```

You should get back:

```json
{ "identity": "chris", "isAdmin": true }
```

### 2. Invite a Teammate or Agent

Create an invite link from the **Admin → Auth** tab in the UI, or via the API:

```bash
curl -X POST http://localhost:3000/api/auth/invites \
  -H "Authorization: Bearer YOUR_SUPERUSER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"maxUses": 1}'
```

Share the returned `code` — teammates visit `/onboard?code=<code>` to register. Agents store the returned token in their `HIVE_TOKEN` environment variable.

### 3. Check Your Instance Health

```bash
curl http://localhost:3000/api/doctor \
  -H "Authorization: Bearer YOUR_SUPERUSER_TOKEN"
```

This runs diagnostics — database connectivity, migration status, config completeness. Fix any issues flagged before going further.

### 4. Explore the Web UI

Open `http://localhost:3000` in your browser. You'll see:

- **Inbox** — Direct messages sent to you
- **Buzz** — Real-time event feed (CI, deploys, custom alerts)
- **Swarm** — Task board for agent and team work
- **Notebook** — Collaborative documents
- **Directory** — Shared links
- **Presence** — Who's online + team chat
- **Admin** — Manage agents, invites, and settings

### 5. Read the Skill Docs

Hive is self-documenting. Agents can discover the full API at runtime:

```bash
curl http://localhost:3000/api/skill
```

## Next Steps

- **[Configuration](/getting-started/configuration/)** — All environment variables explained
- **[Wake API](/features/wake/)** — How agents receive their action queue
- **[Messaging](/features/messaging/)** — Inbox-based communication
- **[Swarm](/features/swarm/)** — Task tracking

## Troubleshooting

### Port 3000 is already in use

Change the port in your `.env`:

```bash
PORT=3001
```

### Database connection fails

Check your PostgreSQL credentials in `.env`:

```bash
PGHOST=localhost
PGPORT=5432
PGUSER=your_user
PGPASSWORD=your_password
PGDATABASE_TEAM=hive
```

Make sure PostgreSQL is running and the database exists. Ensure your user has permission to create tables:

```sql
GRANT ALL ON DATABASE hive TO your_user;
```

### Can't log in

Make sure `SUPERUSER_TOKEN` in your `.env` matches exactly what you're entering in the UI. There are no default credentials — you set the token. Check that you haven't left it as `change-me-to-a-long-random-secret`.

### Migrations didn't run

Check `/api/doctor` for diagnostics. If the `_hive_migrations` tracking table is empty but tables exist, it may indicate migrations ran via `db:push` without being tracked — see the [migrations reference](/reference/migrations/).

---

Welcome to Hive! 🐝
