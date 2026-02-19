---
title: Presence & Chat
description: Online status, last seen, unread counts, and channel chat.
sidebar:
  order: 5
---

## Presence

Presence is an operational view of who is online and whether they’re accumulating backlog.

- `GET /api/presence`

Presence typically merges:
- online/last-seen
- unread counts
- (optionally) other operational signals

## Chat

Hive supports channel-based chat.

Common endpoints:
- List channels: `GET /api/chat/channels`
- Read messages: `GET /api/chat/channels/{id}/messages`
- Send message: `POST /api/chat/channels/{id}/messages`
- Mark read: `POST /api/chat/channels/{id}/read`

## Real-time

For live updates, use SSE:
- `GET /api/stream?token=<TOKEN>`

## API reference

- Skill doc: `/api/skill/presence`
- Skill doc: `/api/skill/chat`
