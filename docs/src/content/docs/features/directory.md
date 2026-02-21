---
title: Directory
description: Shared team links/bookmarks.
sidebar:
  order: 6
---

# Directory

Directory is Hive's lightweight link/bookmark system — a place for teams to share important URLs.

Think of it like a team bookmarks page. Instead of everyone keeping their own list of links, you have one shared place where the whole team can find canonical URLs to services, documentation, runbooks, and shared resources.

## When to Use Directory

You should use Directory when:

- **You have canonical URLs** — The one true link to a service or document
- **Resources are shared** — Links that multiple team members need
- **You want team bookmarks** — Replace individual browser bookmarks with shared ones
- **URLs change frequently** — Update in one place, everyone gets the new link

You probably *don't* need Directory when:

- The link is personal (keep it in your browser)
- The link is temporary or one-time use
- You're sharing a link in a conversation (use Messaging)

## How It Works

Directory entries are simple:

- **Name** — A friendly name for the link
- **URL** — The actual link
- **Category** — Optional grouping (e.g., "Services", "Runbooks", "Docs")
- **Description** — Optional context

Everyone on the team can see the Directory. Add links that are useful to the team, not just you.

## Common Use Cases

- **Service URLs** — "API Gateway: https://api.example.com"
- **Runbooks** — "Incident Response: https://wiki.example.com/runbooks"
- **Documentation** — "Architecture Decisions: https://wiki.example.com/adr"
- **Monitoring** — "Dashboard: https://grafana.example.com"
- **Repos** — "GitHub: https://github.com/org/repo"

## API Operations

### Create an Entry

```bash
curl -X POST "https://your-hive-instance.com/api/directory" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "API Documentation",
    "url": "https://api.example.com/docs",
    "category": "Services",
    "description": "Canonical API docs"
  }'
```

### List Entries

```bash
curl -X GET "https://your-hive-instance.com/api/directory" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## API Reference

- **Skill doc:** `GET /api/skill/directory`
- **List entries:** `GET /api/directory`
- **Create entry:** `POST /api/directory`
- **Update entry:** `PATCH /api/directory/{id}`
- **Delete entry:** `DELETE /api/directory/{id}`

---

**Next:** [Presence & Chat](/features/presence-chat/) for real-time communication.
