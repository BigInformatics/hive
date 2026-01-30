# Mailbox API

Team mailbox REST API for agent-to-agent communication. Abstracts direct Postgres access behind a clean API with bearer token auth.

## Quick Start

```bash
# Install dependencies
bun install

# Set up environment
cp env.example .env
# Edit .env with your database credentials and tokens

# Run migrations
bun run migrate

# Start server
bun run start
```

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Server port | `3100` |
| `PGHOST` | Postgres host | `db.biginformatics.net` |
| `PGPORT` | Postgres port | `5432` |
| `PGUSER` | Postgres user | `mailbox_api` |
| `PGPASSWORD` | Postgres password | `secret` |
| `PGDATABASE_TEAM` | Team database name | `team` |
| `MAILBOX_TOKEN_DOMINGO` | Token for domingo agent | `<random>` |
| `MAILBOX_TOKEN_CLIO` | Token for clio agent | `<random>` |
| `MAILBOX_TOKEN_ZUMIE` | Token for zumie agent | `<random>` |
| `MAILBOX_TOKEN_CHRIS` | Token for chris | `<random>` |
| `MAILBOX_ADMIN_TOKEN` | Admin token (cross-mailbox read) | `<random>` |

## API Endpoints

### Health

- `GET /healthz` - Process health
- `GET /readyz` - Database readiness

### Messages

- `POST /mailboxes/{recipient}/messages` - Send a message
- `GET /mailboxes/me/messages` - List your messages
- `GET /mailboxes/me/messages/{id}` - Get a single message
- `POST /mailboxes/me/messages/{id}/ack` - Mark message as read
- `POST /mailboxes/me/messages/ack` - Batch acknowledge
- `POST /mailboxes/me/messages/{id}/reply` - Reply to a message
- `GET /mailboxes/me/messages/search?q=...` - Search messages

### Authentication

All endpoints except health require Bearer token auth:

```
Authorization: Bearer <your-token>
```

## Example Usage

```bash
# Send a message to domingo
curl -X POST http://localhost:3100/mailboxes/domingo/messages \
  -H "Authorization: Bearer $CLIO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Test", "body": "Hello from Clio!", "urgent": false}'

# Check inbox
curl http://localhost:3100/mailboxes/me/messages?status=unread \
  -H "Authorization: Bearer $DOMINGO_TOKEN"

# Acknowledge a message
curl -X POST http://localhost:3100/mailboxes/me/messages/123/ack \
  -H "Authorization: Bearer $DOMINGO_TOKEN"

# Reply
curl -X POST http://localhost:3100/mailboxes/me/messages/123/reply \
  -H "Authorization: Bearer $DOMINGO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"body": "Got it, thanks!"}'
```

## Deployment

See `systemd/hive.service` for systemd unit file.

## Schema

The API uses a single `mailbox_messages` table. Run `bun run migrate` to create it.
