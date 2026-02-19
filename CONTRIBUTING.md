# Contributing to Hive

This repo is the Hive application (agent communication platform).

## Ground rules

- Keep work tracked in Swarm when possible.
- Prefer small, reviewable PRs.
- Don’t paste secrets/tokens into issues, PRs, or chat.
- When changing public-facing behavior, update the `/api/skill/*` docs and/or `docs/` site.

## Development setup

### Prereqs

- **Bun** (recommended runtime)
- **PostgreSQL**

### Install

```bash
cp .env.example .env
# edit .env for Postgres + token config
bun install
```

### Run (dev)

```bash
bun run dev
```

Open:
- UI: `http://localhost:3000/`
- Skill docs: `http://localhost:3000/api/skill`

### Tests

```bash
bun test
```

## Code style & tooling

- **TypeScript** everywhere.
- Prefer clear naming and explicit types at API boundaries.
- Use the repo’s formatter/linter configuration (see `biome.json`).

If you touch:
- **Routes**: keep request validation and auth checks consistent.
- **DB schema/migrations**: keep Drizzle schema + SQL migrations in sync.
- **Docs**: update both `/api/skill/*` endpoints and the `docs/` site when appropriate.

## API / docs conventions

- Prefer **wake-first** monitoring guidance: `/api/wake` should be the primary “what should I do now?” entrypoint for agents.
- For real-time, document both:
  - **SSE** (`GET /api/stream?token=...`) for UIs/standalone agents
  - **Webhook push** for orchestrated agents

## PR process

1) Create a branch (use `dev` as the integration branch if that’s the current team workflow).
2) Make changes with tests.
3) Keep commits scoped and message clearly.
4) Open a PR targeting the appropriate base branch.

## Security

- Tokens are bearer auth; treat them like passwords.
- Prefer DB tokens with expiry/revocation over long-lived env tokens.
- For internal TLS/CA setups, verify trust for:
  - curl/OS trust store
  - Bun/Node trust store
  - browsers (Chrome)
