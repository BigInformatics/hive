---
title: Required Technologies
description: What you need to run and operate Hive.
---

Hive is a full-stack TypeScript app.

## Runtime

- **Bun** (recommended) for local dev and scripts
- Node.js 22+ is also used in some environments, but the repo is optimized around Bun.

## Database

- **PostgreSQL** (16+ recommended)

## Deployment (typical)

Depending on your environment you may use:
- Docker / Docker Compose
- Dokploy (team deployment)

## Optional integrations

- **OneDev** (for linking deployments/health checks; varies by environment)
- External webhook sources feeding Buzz (CI, deploys, monitors, etc.)

## Client trust (internal TLS)

If Hive is served with an internal CA, ensure the CA is trusted by:
- the OS trust store (curl)
- Bun/Node runtime (server-side clients)
- Chrome (human operators)
