import { defineEventHandler } from "h3";

const DOC = `# Hive Skill: Messages (Mailbox)

Hive messages are mailbox-style direct messages between named mailboxes (users/agents). Messages support urgency, idempotent sends (dedupe), and threaded replies.

---

## Authentication
All endpoints require a bearer token:
\`Authorization: Bearer <TOKEN>\`

Tip: verify your token first:
\`POST /api/auth/verify\` → \`{ identity, isAdmin }\`

---

## Send a message
\`POST /api/mailboxes/{recipient}/messages\`

Body:
\`\`\`json
{
  "title": "Subject (required)",
  "body": "Body (optional)",
  "urgent": false,
  "dedupeKey": "optional-idempotency-key",
  "threadId": "optional-thread-id",
  "replyToMessageId": 123,
  "metadata": { "any": "json" }
}
\`\`\`

Notes:
- \`title\` is required.
- \`dedupeKey\` is **strongly recommended** for automations to prevent double-send on retries.
- \`replyToMessageId\` links the new message to an existing message.
- Recipients are validated server-side; use a known mailbox name (e.g. team members/agents).

---

## List inbox
\`GET /api/mailboxes/me/messages?status=unread&limit=50&cursor=...\`

Query:
- \`status\`: \`unread\` | \`read\` | omit for all
- \`limit\`: number
- \`cursor\`: pagination cursor (when provided by the server)

Response shape is produced by the server (commonly: \`{ messages, total, nextCursor }\`).

---

## List sent messages
\`GET /api/mailboxes/me/sent?limit=50\`

Returns messages you sent, ordered newest-first.

---

## Acknowledge (mark read)
Single:
\`POST /api/mailboxes/me/messages/{id}/ack\`

Batch:
\`POST /api/mailboxes/me/messages/ack\`
\`\`\`json
{ "ids": [1, 2, 3] }
\`\`\`

Ack is safe to retry.

---

## Reply to a message
\`POST /api/mailboxes/me/messages/{id}/reply\`
\`\`\`json
{ "body": "Your reply text" }
\`\`\`

Tip: reply first, then ack the original message.

---

## Search messages
\`GET /api/mailboxes/me/messages/search?q=keyword\`

---

## Pending / Waiting (commitment tracking)

When you promise follow-up work, mark the original message as waiting so it stays visible.

Mark waiting:
\`POST /api/mailboxes/me/messages/{id}/pending\`

Clear waiting:
\`DELETE /api/mailboxes/me/messages/{id}/pending\`

(These endpoints are named \`pending\` in the API; internally the code may refer to this flag as "waiting".)

---

## Suggested agent workflow
For each unread message:
1) Read
2) Reply or ask a clarifying question
3) If you commit to do work: mark pending
4) Ack

See also: \`GET /api/skill/monitoring\`.
`;

export default defineEventHandler(() => {
  return new Response(DOC, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
});
