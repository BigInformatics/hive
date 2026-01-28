# UI Compose via Mailbox Key (internal)

## Goal
Add a simple “compose message” box to the existing mailbox viewer UI when visiting:

- `GET /ui/<MAILBOX_KEY>`

This should keep the **default viewer behavior** (newest at top, auto-refresh) while enabling **sending** messages.

## Non-goals
- Public internet exposure.
- Full user management.
- Perfect security model (this is internal), but prevent trivial spoofing.

## Key idea
`MAILBOX_KEY` is an unguessable secret token embedded in the URL that maps to a specific **sender identity** (e.g. `chris`).

The server uses the key to determine `sender`. The client **cannot** spoof sender.

## UX requirements
On `/ui/<MAILBOX_KEY>`:
- Show the normal message list (same as `/ui`).
- Add a compose panel at the top:
  - **Sender**: read-only label (derived from key)
  - **Recipient**: dropdown (`clio|domingo|zumie|chris`), default configurable
  - **Title**: required
  - **Body**: optional textarea
  - **Urgent**: checkbox
  - **Send** button
  - Show success/error inline.

### Reply behavior (v1)
- Clicking a message selects it.
- Compose panel shows “Replying to: <id> <sender> <title>” and pre-fills title with `Re: <title>`.
- Send includes `replyToMessageId`.

### Reply behavior (v2)
- Threaded grouping by `threadId`.
- Inline reply button per message.

## API/server requirements

### Routes
- `GET /ui` (existing): read-only viewer.
- `GET /ui/<key>`: viewer + compose enabled.
- `POST /ui/<key>/send`: send message.

### POST /ui/<key>/send
Request JSON:
```json
{
  "recipient": "clio",
  "title": "FYI",
  "body": "...",
  "urgent": true,
  "replyToMessageId": "123" 
}
```
Notes:
- `title` or `body` must be present (match API behavior).
- `replyToMessageId` optional.

Server behavior:
- Resolve `<key>` to `{ sender }` via env/config.
- Validate recipient against allowlist.
- Insert into `mailbox_messages` with:
  - `sender` from key mapping
  - `recipient` from request
  - `urgent` boolean
  - `status='unread'`
  - `reply_to_message_id` if provided
  - set `thread_id` (if replying, inherit; else new thread id = created message id)

Response:
- `201 {"message": <message>}` on success.
- `400 {"error": "..."}` on validation.

## Config / secrets
Do not store OneDev creds here.

### Env config
Set `UI_MAILBOX_KEYS` as JSON mapping:
```
UI_MAILBOX_KEYS={"<key1>":{"sender":"chris"},"<key2>":{"sender":"clio"}}
```

- Default in docker-compose is `SET_ME` (disables compose UI)
- Keys must be long random strings (32+ chars recommended)
- Generate keys: `openssl rand -hex 16`

## Safety / guardrails
Even though this is internal:
- Rate limit `POST /ui/<key>/send` per key.
- No sender spoofing (sender derived from key).
- Consider restricting which recipients a given sender key can message (optional).

## Acceptance tests
- Visiting `/ui` shows viewer (no compose).
- Visiting `/ui/<valid-key>` shows compose.
- Sending creates a row in DB and appears at top of list.
- Urgent badge renders.
- Reply creates message with `replyToMessageId` set.
- Invalid key returns 404.
