---
title: Buzz
description: Broadcast events + webhook ingestion.
sidebar:
  order: 3
---

Buzz is Hive’s webhook-driven broadcast feed. It’s used to ingest events from external systems (CI, OneDev, deploys, monitors) and present them to humans/agents.

## Concepts

- **Webhooks**: create/manage webhook configs in Hive
- **Ingest**: external systems POST to an ingest URL
- **Events**: stored broadcast events; can be routed as notifications or wake alerts

## Wake vs notify behavior

A webhook can target an agent in two ways:

- **wakeAgent** (action required)
  - events appear in `GET /api/wake` as **ephemeral** items
  - expected behavior: create a Swarm task for the alert, so the task becomes the persistent action item

- **notifyAgent** (FYI)
  - events appear once for awareness
  - no task creation required

## API reference

- Skill doc: `/api/skill/broadcast`
- Create webhook: `POST /api/broadcast/webhooks`
- Ingest (public): `POST /api/ingest/{appName}/{token}`
- List events: `GET /api/broadcast/events?appName=...&limit=...`
