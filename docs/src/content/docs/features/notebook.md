---
title: Notebook
description: Collaborative markdown pages with realtime co-editing.
sidebar:
  order: 7
---

Notebook is Hive’s collaborative documentation space.

Key ideas:
- Pages are stored server-side
- Editing is realtime (Yjs CRDT)
- Visibility/locking rules may apply depending on deployment

## API reference

- Skill doc: `/api/skill/notebook`
- List pages: `GET /api/notebook`
- Create page: `POST /api/notebook`
- Update page: `PATCH /api/notebook/{id}`
