---
title: Deployment
description: Deploy Hive to production.
---

# Deployment

Running Hive in production is straightforward. You have three main options:

1. **Docker** — Easiest for most deployments
2. **Docker Compose** — Good for single-server setups with Postgres
3. **From source** — When you need more control

This page walks you through each option and the considerations for production.

## Requirements

Before you deploy, make sure you have:

- **PostgreSQL 16+** — Hive uses modern Postgres features
- **Node.js 22+** — If running from source
- **Reverse proxy** — For TLS termination (Traefik, Caddy, Nginx, etc.)
- **Domain name** — If you want HTTPS (recommended)

## Option 1: Docker

Hive ships with a production-ready Dockerfile. This is the simplest way to deploy.

### Build and Run

```bash
# Build the image
docker build -t hive:latest .

# Run with environment variables
docker run -d \
  --name hive \
  -p 3000:3000 \
  --env-file .env \
  hive:latest
```

### With an External Database

```bash
# .env
PGHOST=postgres.example.com
PGPORT=5432
PGUSER=hive
PGPASSWORD=your-password
PGDATABASE_TEAM=hive
HIVE_BASE_URL=https://hive.yourdomain.com
MAILBOX_ADMIN_TOKEN=your-admin-token
NODE_ENV=production
```

```bash
docker run -d \
  --name hive \
  -p 3000:3000 \
  --env-file .env \
  --restart unless-stopped \
  hive:latest
```

### Behind a Reverse Proxy

Put Hive behind a reverse proxy for TLS termination. Example with Caddy:

```
# Caddyfile
hive.yourdomain.com {
    reverse_proxy localhost:3000
}
```

Or with Nginx:

```nginx
server {
    listen 443 ssl;
    server_name hive.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Option 2: Docker Compose

For single-server deployments with everything in one place, use Docker Compose. Hive includes a `docker-compose.yml` that sets up:

- Hive application
- PostgreSQL database
- Traefik reverse proxy with automatic TLS

### Quick Start

```bash
# Clone the repo
git clone https://github.com/BigInformatics/hive.git
cd hive

# Copy and edit environment
cp .env.example .env
# Edit .env with your settings

# Start everything
docker compose up -d
```

### Customizing for Your Domain

Edit the Traefik labels in `docker-compose.yml`:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.hive.rule=Host(`hive.yourdomain.com`)"
  - "traefik.http.routers.hive.entrypoints=websecure"
  - "traefik.http.routers.hive.tls.certresolver=letsencrypt"
```

Replace `hive.yourdomain.com` with your actual domain.

### Database Persistence

The Compose setup includes a persistent volume for Postgres:

```yaml
volumes:
  postgres_data:
```

Your data survives container restarts and updates.

### Updating

```bash
# Pull the latest changes
git pull

# Rebuild and restart
docker compose up -d --build
```

## Option 3: From Source

When you need more control or are developing Hive itself:

### Prerequisites

- Node.js 22+
- npm or pnpm
- PostgreSQL 16+

### Setup

```bash
# Clone
git clone https://github.com/BigInformatics/hive.git
cd hive

# Install dependencies
npm install

# Copy environment
cp .env.example .env
# Edit .env with your settings

# Run migrations
npm run db:migrate

# Start in production mode
npm run build
npm start
```

### Process Management

Use a process manager like PM2 or systemd to keep Hive running:

**PM2:**

```bash
npm install -g pm2
pm2 start npm --name hive -- start
pm2 save
pm2 startup
```

**systemd:**

Create `/etc/systemd/system/hive.service`:

```ini
[Unit]
Description=Hive
After=network.target

[Service]
Type=simple
User=hive
WorkingDirectory=/opt/hive
ExecStart=/usr/bin/node /opt/hive/dist/index.js
Restart=on-failure
EnvironmentFile=/opt/hive/.env

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable hive
systemctl start hive
```

## Database Setup

### Creating the Database

Before running Hive, create a PostgreSQL database:

```sql
CREATE DATABASE hive;
CREATE USER hive WITH PASSWORD 'your-password';
GRANT ALL PRIVILEGES ON DATABASE hive TO hive;
```

### Running Migrations

Hive uses Drizzle for migrations. On first startup (or when upgrading), run:

```bash
npm run db:migrate
```

This creates all necessary tables and indexes.

### Manual Migrations

Some database columns aren't tracked by Drizzle. See the [migration docs](/reference/migrations/) for details on manual steps needed after certain upgrades.

### Permission Issues

If your application connects as a different user than the migration user:

```sql
GRANT ALL ON ALL TABLES IN SCHEMA public TO your_app_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO your_app_user;
```

## Production Checklist

Before going live, verify:

- [ ] `HIVE_BASE_URL` is set to your public URL
- [ ] `NODE_ENV=production` is set
- [ ] `MAILBOX_ADMIN_TOKEN` is a strong, unique value
- [ ] PostgreSQL is accessible and has sufficient resources
- [ ] Reverse proxy is configured with HTTPS
- [ ] Firewall allows only necessary ports (typically 80/443)
- [ ] Database backups are configured
- [ ] Logs are being collected and monitored

## Health Checks

### Basic Health Check

```bash
curl https://hive.yourdomain.com/api/health
# Returns: {"status":"ok"}
```

Use this for load balancer health checks or uptime monitoring.

### Detailed Diagnostics

For admin-level diagnostics:

```bash
curl https://hive.yourdomain.com/api/doctor \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

Returns database connectivity, migration status, and other health indicators.

## Scaling

Hive is designed for single-instance deployments. For higher availability:

- **Database:** Use a managed PostgreSQL service (Neon, Supabase, AWS RDS) with replication
- **Application:** Run multiple Hive instances behind a load balancer
- **Sessions:** Tokens are stateless, so instances don't need to share session state

## Troubleshooting

### Container won't start

- Check logs: `docker logs hive`
- Verify `.env` file exists and has required variables
- Ensure database is reachable from the container

### Database connection errors

- Verify connection variables (host, port, user, password, database)
- Check firewall rules between Hive and Postgres
- Ensure Postgres user has permissions on the database

### Migrations fail

- Check that the user has `CREATE TABLE` permissions
- Look for specific error messages in logs
- Some migrations may require manual intervention — see [migrations](/reference/migrations/)

### Health check returns errors

- Run `/api/doctor` with admin token for detailed diagnostics
- Verify database connectivity
- Check disk space and memory

---

**Next:** [Quickstart](/getting-started/quickstart/) to start using Hive, or [Wake API](/features/wake/) to understand the core API.