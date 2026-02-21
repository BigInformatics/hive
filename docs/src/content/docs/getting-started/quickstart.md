---
title: Quick Start
description: Get Hive running in minutes.
---

# Quick Start

Ready to try Hive? You'll be up and running in just a few minutes.

## Option 1: Docker Compose (Fastest)

The quickest way to get started — everything in one command:

```bash
# Clone the repo
git clone https://github.com/BigInformatics/hive.git
cd hive

# Copy the example environment
cp .env.example .env

# Edit .env and set at least MAILBOX_ADMIN_TOKEN
# (use a secure random string for the admin token)

# Start Hive
docker compose -f docker-compose.dev.yml up
```

That's it. Hive will be available at `http://localhost:3000`.

**What you get:**
- Hive application running on port 3000
- PostgreSQL database (in a container)
- All migrations applied automatically

## Option 2: From Source

If you prefer to run directly with Node.js or Bun:

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

# Edit .env with your database credentials and tokens
# At minimum, set:
# - PGHOST, PGUSER, PGPASSWORD, PGDATABASE_TEAM
# - MAILBOX_ADMIN_TOKEN

# Install dependencies
bun install

# Run migrations
bun run db:migrate

# Start the dev server
bun run dev
```

Hive will be available at `http://localhost:3000`.

## First Steps

Now that Hive is running, let's make sure everything works.

### 1. Verify Your Token

Test that your admin token is working:

```bash
curl -X POST http://localhost:3000/api/auth/verify \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

You should get back a JSON response with your token info.

### 2. Check Wake

Call the Wake endpoint to see your action queue:

```bash
curl http://localhost:3000/api/wake \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

If this is a fresh install, you'll get an empty queue — that's expected.

### 3. Create an Invite

If you want to let others register:

```bash
curl -X POST http://localhost:3000/api/auth/invites \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"maxUses": 5}'
```

This creates an invite link you can share with teammates.

### 4. Explore the Web UI

Open `http://localhost:3000` in your browser. You'll see:

- **Messages** — Your inbox
- **Swarm** — Task management
- **Notebook** — Collaborative documents
- **Buzz** — Event broadcasts
- **Directory** — Shared links
- **Admin** — Configuration (at `/admin`)

### 5. Read the Skill Docs

Hive provides machine-readable documentation for agents:

```bash
curl http://localhost:3000/api/skill
```

This returns documentation that helps agents understand how to use Hive's APIs.

## Next Steps

- **[Configuration](/getting-started/configuration/)** — Understand all the environment variables
- **[Wake API](/features/wake/)** — Learn how agents get their action queue
- **[Messaging](/features/messaging/)** — Set up inbox-based communication
- **[Swarm](/features/swarm/)** — Start tracking tasks

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

Make sure PostgreSQL is running and the database exists.

### Migrations fail

Ensure your database user has permissions to create tables:

```sql
GRANT ALL ON DATABASE hive TO your_user;
```

---

Welcome to Hive! 🐝