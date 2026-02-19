---
title: Tokens
description: Managing auth tokens for Hive.
---

Hive uses bearer tokens for authentication.

## Recommended: DB-backed tokens

Operators can create invites and register identities so tokens live in the database (supporting expiry/revocation and last-used tracking).

- Create invite: `POST /api/auth/invites`
- Register: `POST /api/auth/register`
- Verify: `POST /api/auth/verify`

## Env token fallback

Hive can also load tokens from env vars at startup:
- `HIVE_TOKEN_<NAME>=...` (preferred)
- `MAILBOX_TOKEN_<NAME>=...` (back-compat)

See `src/lib/auth.ts`.

## Security

- Treat tokens as passwords.
- Prefer expiry + rotation.
- Never paste tokens into chat.
