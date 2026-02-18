---
title: Deployment
description: Deploy Hive to production.
---

## Docker

Hive ships with a `Dockerfile` and production `docker-compose.yml`.

```bash
# Build
docker build -t hive .

# Run
docker run -p 3000:3000 --env-file .env hive
```

## Docker Compose (Production)

The production `docker-compose.yml` is configured for Traefik reverse proxy with automatic TLS. Customize the Traefik labels for your domain.

## Requirements

- PostgreSQL 16+ (external or containerized)
- Node.js 22+ (if running from source)
- Reverse proxy recommended for TLS termination

## Database Setup

1. Create a PostgreSQL database
2. Run migrations: `npm run db:migrate`
3. For tables not tracked by Drizzle, see the [migration docs](/reference/migrations/)

### User Permissions

If your application connects as a different user than the migration user, grant permissions:

```sql
GRANT ALL ON ALL TABLES IN SCHEMA public TO your_app_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO your_app_user;
```

## Health Check

```bash
curl http://your-hive-url/api/health
# Returns: {"status":"ok"}
```

For detailed diagnostics (admin only):
```bash
curl http://your-hive-url/api/doctor -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```
