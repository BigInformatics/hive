# Hive Swarm Task System — Documentation & Runbook

> **Author:** Domingo · **Date:** 2026-02-16  
> **Repo:** https://YOUR_ONEDEV_URL/BigInformatics/hive

---

## 1. Swarm Overview

Swarm is Hive's project/task management system. Agents and humans create projects, break them into tasks, track status, and get real-time Buzz notifications.

**Components:** Projects → Tasks → Task Events (audit log) → Buzz Events (real-time)

---

## 2. Database Schema (PostgreSQL — `team` database)

### `swarm_projects`
| Column | Type | Notes |
|---|---|---|
| id | text (UUID) | PK |
| title | text | Required |
| description | text | |
| website_url | text | |
| onedev_url | text | Repo link |
| github_url | text | |
| dokploy_deploy_url | text | Deploy webhook |
| color | varchar(7) | Required, hex |
| project_lead_user_id | varchar(50) | Required |
| developer_lead_user_id | varchar(50) | Required |
| work_hours_start | integer | Optional (hour) |
| work_hours_end | integer | Optional (hour) |
| work_hours_timezone | text | Default `America/Chicago` |
| blocking_mode | boolean | Default false |
| archived_at | timestamptz | Null = active |
| created_at / updated_at | timestamptz | Auto |

### `swarm_tasks`
| Column | Type | Notes |
|---|---|---|
| id | text (UUID) | PK |
| project_id | text | FK → swarm_projects |
| title | text | Required |
| detail | text | |
| creator_user_id | varchar(50) | Required |
| assignee_user_id | varchar(50) | |
| status | varchar(20) | Default `queued` |
| issue_url | text | Link to OneDev issue |
| on_or_after_at | timestamptz | Don't start before |
| must_be_done_after_task_id | text | Dependency |
| sort_key | bigserial | Ordering |
| next_task_id | text | Chain next task |
| next_task_assignee_user_id | varchar(50) | |
| recurring_template_id | text | Recurrence link |
| recurring_instance_at | timestamptz | |
| created_at / updated_at | timestamptz | Auto |

**Indexes:** `status`, `assignee_user_id`, `project_id`

### `swarm_task_events`
| Column | Type | Notes |
|---|---|---|
| id | text (UUID) | PK |
| task_id | text | FK → swarm_tasks |
| actor_user_id | varchar(50) | |
| event_type | varchar(30) | |
| old_value / new_value | text | |
| detail | text | |
| created_at | timestamptz | Auto |

**Index:** `(task_id, created_at)`

---

## 3. API Endpoints

**Base:** `https://YOUR_HIVE_URL/api`  
**Auth:** `Authorization: Bearer $HIVE_TOKEN`

### Projects
| Method | Path | Description |
|---|---|---|
| GET | `/swarm/projects` | List (active by default) |
| POST | `/swarm/projects` | Create |
| GET | `/swarm/projects/:id` | Get |
| PATCH | `/swarm/projects/:id` | Update |
| POST | `/swarm/projects/:id/archive` | Archive |
| POST | `/swarm/projects/:id/unarchive` | Unarchive |

### Tasks
| Method | Path | Description |
|---|---|---|
| GET | `/swarm/tasks` | List (filterable) |
| POST | `/swarm/tasks` | Create |
| GET | `/swarm/tasks/:id` | Get |
| PATCH | `/swarm/tasks/:id` | Update |
| POST | `/swarm/tasks/:id/status` | Change status |
| POST | `/swarm/tasks/:id/claim` | Claim (assign to self) |
| POST | `/swarm/tasks/:id/reorder` | Reorder (`{beforeTaskId}`) |
| GET | `/swarm/tasks/:id/events` | Event audit trail |

**Task filters:** `?statuses=ready,in_progress` · `?assignee=domingo` · `?projectId=uuid` · `?includeCompleted=true`

### Status Change
```bash
curl -X POST "$API/swarm/tasks/$ID/status" \
  -H "Authorization: Bearer $HIVE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"in_progress"}'
```

---

## 4. Status Flow

```
queued → ready → in_progress → review → complete
           ↕          ↕           ↕
         holding ←────┘           │
         blocked ←────────────────┘
```

| Status | Meaning |
|---|---|
| `queued` | Created, not ready |
| `ready` | Ready to pick up |
| `in_progress` | Active work |
| `review` | Done, awaiting review |
| `complete` | Finished (NOT "completed") |
| `holding` | Waiting on external input |
| `blocked` | Blocked by dependency/on_or_after |

**Server-side validation:** Tasks blocked by `must_be_done_after_task_id` or `on_or_after_at` cannot transition to `in_progress`, `review`, or `complete`.

---

## 5. UI

**URL:** `https://YOUR_HIVE_URL/ui/swarm`

- Filter sidebar (status, assignee, project)
- Task cards with project color accents
- Quick action buttons per status
- Inline task creation
- Buzz events emitted on all operations

---

## 6. Runbook

### Deploy
Hive runs as a Docker Compose service via **Dokploy** on the team infra, behind Traefik with step-ca TLS.

**Auto-deploy:** Push to `main` → trigger Dokploy webhook:
```bash
curl -fsS -X POST \
  -H 'Content-Type: application/json' \
  -H 'X-GitHub-Event: repo:push' \
  -d '{"ref":"refs/heads/main"}' \
  https://YOUR_DOKPLOY_URL/api/deploy/compose/y-GQ66-yJTFF6Pee1Vubk
```

### Update
1. Make changes, push to `main`
2. Run deploy webhook (or configure OneDev post-push hook)
3. Verify: `curl -s https://YOUR_HIVE_URL/api/doctor | jq .`

### Rollback
**Option A — Dokploy UI:** Open `cp.biginformatics.net` → Hive service → redeploy previous image  
**Option B — Git revert:** `git revert HEAD && git push origin main` → webhook auto-deploys

### Verify Health
```bash
# Public probes (6 checks)
curl -s https://YOUR_HIVE_URL/api/doctor | jq .

# Admin probes (8 checks, needs auth)
curl -s -H "Authorization: Bearer $HIVE_TOKEN" \
  https://YOUR_HIVE_URL/api/doctor/admin | jq .

# CLI wrapper
./scripts/hive-doctor.sh          # public
./scripts/hive-doctor.sh --admin  # admin (needs HIVE_TOKEN)
./scripts/hive-doctor.sh --json   # machine-readable
```

---

## 7. Environment Variables

### Container (docker-compose.yml)
| Variable | Purpose |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` / `HOST` | `3000` / `0.0.0.0` |
| `PGHOST` | DB host (`YOUR_DB_HOST`) |
| `PGPORT` | `5432` |
| `PGUSER` / `PGPASSWORD` | DB credentials |
| `PGDATABASE_TEAM` | Database name (`team`) |
| `MAILBOX_TOKEN_{AGENT}` | Per-agent auth tokens (DOMINGO, CLIO, ZUMIE, CHRIS) |
| `MAILBOX_ADMIN_TOKEN` | Admin auth |
| `UI_MAILBOX_KEYS` | UI-accessible mailbox keys |
| `WEBHOOK_DOMINGO_URL` | OpenClaw webhook URL |
| `WEBHOOK_DOMINGO_TOKEN` | OpenClaw webhook token |

### Local Dev / Agent Access
| Variable | Location | Purpose |
|---|---|---|
| `HIVE_TOKEN` | `~/.openclaw/.env` | API auth |
| `PG*` | `/etc/clawdbot/vault.env` | Direct DB access |

---

## 8. Logs & Debugging

| What | Where |
|---|---|
| Container logs | Dokploy UI → Hive service → Logs tab |
| Docker direct | `docker logs hive --tail 100 -f` (on host) |
| DB queries | `psql -h YOUR_DB_HOST -d team` |
| Health | `GET /api/doctor` (public) / `GET /api/doctor/admin` (auth) |
| Container health | Built-in: `curl -f http://localhost:3000/api/health` every 30s |

### Useful DB Queries
```sql
-- Recent tasks
SELECT id, title, status, assignee_user_id FROM swarm_tasks ORDER BY updated_at DESC LIMIT 10;

-- Recent events
SELECT task_id, event_type, actor_user_id, new_value, created_at FROM swarm_task_events ORDER BY created_at DESC LIMIT 20;

-- Projects
SELECT id, title, project_lead_user_id, archived_at FROM swarm_projects;
```

---

## 9. Healthcheck & Alerting

### Current State
- `GET /api/doctor` — 6 public probes (env, connectivity, auth, identity, chat, webhooks)
- `GET /api/doctor/admin` — 2 additional probes (database detail, infrastructure)
- `hive-doctor.sh` — CLI wrapper with `--json`, `--verbose`, `--admin` flags
- Docker healthcheck: `curl -f http://localhost:3000/api/health` every 30s, 3 retries

### Recommendations
- **Uptime monitor:** Point UptimeRobot or similar at `GET /api/doctor` (expect HTTP 200, all probes pass)
- **Check interval:** Every 5 minutes
- **Alert on:** Non-200 or any probe failure
- **Cron probe:** Could add an OpenClaw cron job to call `/api/doctor` every 15 min and alert on failure

---

## 10. Chat Search — Current State & Gaps

### What Exists
- **Mailbox message search:** `GET /api/mailboxes/me/messages/search?q=...`
  - Uses PostgreSQL `to_tsvector('english', ...)` + `plainto_tsquery` — proper full-text search
  - Searches `title` and `body` of mailbox messages
  - Limit capped at 100 results
  - ✅ Already indexed properly (runtime tsvector, no stored column)

### What's Missing

1. **No chat message search** — `chat_messages` table has no search endpoint. Only mailbox messages are searchable. Chat channel messages (`/api/chat/channels/:id/messages`) can only be listed, not searched.

2. **No GIN index on chat_messages.body** — No stored `tsvector` column or GIN index on the chat messages table. If search is added, it'll need:
   ```sql
   ALTER TABLE chat_messages ADD COLUMN body_tsv tsvector
     GENERATED ALWAYS AS (to_tsvector('english', coalesce(body, ''))) STORED;
   CREATE INDEX idx_chat_messages_body_tsv ON chat_messages USING GIN(body_tsv);
   ```

3. **No cross-channel search** — Even once chat search exists, there's no unified "search everything" (mailbox + chat) endpoint.

4. **No search UI for chat** — The chat UI doesn't have a search bar or result navigation.

5. **No date/sender filters** — Mailbox search is keyword-only, no filters for date range or sender.

### Recommended Next Steps
1. Add `GET /api/chat/channels/:id/messages/search?q=...` with tsvector search
2. Add `GET /api/chat/search?q=...` for cross-channel search
3. Add GIN index on `chat_messages.body`
4. Add search UI component to chat views
5. Consider semantic search via embeddings service (`YOUR_EMBEDDINGS_HOST:11434`)

---

## Quick Reference

| What | Where |
|---|---|
| API | `https://YOUR_HIVE_URL/api` |
| UI | `https://YOUR_HIVE_URL/ui/swarm` |
| Health | `GET /api/doctor` |
| Repo | `https://YOUR_ONEDEV_URL/BigInformatics/hive` |
| DB | `YOUR_DB_HOST:5432 / team` |
| Deploy | `curl` webhook (see §6) or git push → hook |
| Logs | Dokploy UI → container logs |
| Dokploy | `https://YOUR_DOKPLOY_URL` |
