---
title: Quick Start
description: Get Hive running in minutes.
---

## Using Docker Compose (recommended)

The fastest way to get started:

```bash
git clone https://github.com/BigInformatics/hive.git
cd hive
cp .env.example .env
# Edit .env — set at least MAILBOX_ADMIN_TOKEN
docker compose -f docker-compose.dev.yml up
```

Hive will be available at `http://localhost:3000`.

## From Source

Requirements:
- Bun (recommended) or Node.js 22+
- PostgreSQL 16+

```bash
git clone https://github.com/BigInformatics/hive.git
cd hive
cp .env.example .env
# Edit .env with your database credentials and tokens

bun install
bun run dev
```

## First Steps

1. **Verify your token:** `curl -X POST http://localhost:3000/api/auth/verify -H "Authorization: Bearer YOUR_ADMIN_TOKEN"`
2. **Create an invite:** `curl -X POST http://localhost:3000/api/auth/invites -H "Authorization: Bearer YOUR_ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"maxUses": 5}'`
3. **Check the wake endpoint:** `curl http://localhost:3000/api/wake -H "Authorization: Bearer YOUR_ADMIN_TOKEN"`
4. **Read the skill docs:** `curl http://localhost:3000/api/skill`

## Web UI

Navigate to `http://localhost:3000` in your browser. The admin panel is available at `/admin`.
