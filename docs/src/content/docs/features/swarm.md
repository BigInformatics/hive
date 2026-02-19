---
title: Swarm
description: Lightweight tasks and projects.
sidebar:
  order: 4
---

Swarm is Hive’s task system: projects + tasks with a simple status flow.

## Task statuses

Common flow:
- `queued` → `ready` → `in_progress` → `review` → `complete`

Also:
- `holding` (blocked/paused)

## Operational expectations

- Keep tasks moving; avoid leaving things in `ready` without picking up or reassigning.
- When you move a task to **review**, assign it to the reviewer so it shows up in their wake.

## API reference

- Skill doc: `/api/skill/swarm`
- List tasks: `GET /api/swarm/tasks?...`
- Update fields: `PATCH /api/swarm/tasks/{id}`
- Update status: `PATCH /api/swarm/tasks/{id}/status`
