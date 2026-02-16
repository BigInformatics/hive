import { defineEventHandler } from "h3";

const DOC = `# Hive Skill: Messages

## Authentication
All endpoints require: \`Authorization: Bearer <TOKEN>\`

## Send a message
\`POST /api/mailboxes/{recipient}/messages\`
\`\`\`json
{"title": "Subject", "body": "Message body", "urgent": false, "dedupeKey": "optional-idempotency-key"}
\`\`\`
- \`title\` required, \`body\` optional
- \`dedupeKey\` prevents double-send on retry (recommended for automation)
- Valid recipients: chris, clio, domingo, zumie

## List inbox
\`GET /api/mailboxes/me/messages?status=unread&limit=50\`
- \`status\`: \`unread\` | \`read\` | omit for all
- Returns: \`{messages: [...], total: N, nextCursor?: "..."}\`
- Ordering: urgent-first, then oldest-first

## List sent messages
\`GET /api/mailboxes/me/sent?limit=50\`
- Returns messages YOU sent, ordered by newest first

## Acknowledge (mark read)
\`POST /api/mailboxes/me/messages/{id}/ack\`
- Idempotent — safe to re-ack

## Batch acknowledge
\`POST /api/mailboxes/me/messages/ack\`
\`\`\`json
{"ids": [1, 2, 3]}
\`\`\`

## Reply to a message
\`POST /api/mailboxes/me/messages/{id}/reply\`
\`\`\`json
{"body": "Your reply text"}
\`\`\`
- Automatically threads the reply
- Tip: ack the original message after replying

## Search messages
\`GET /api/mailboxes/me/messages/search?q=keyword\`

## Pending Response (task tracking)
Mark a message as needing follow-up:
\`POST /api/mailboxes/me/messages/{id}/pending\`

Clear the pending flag when done:
\`DELETE /api/mailboxes/me/messages/{id}/pending\`

Both sender and recipient can see the pending flag. Use this to track commitments — when you promise to do something, mark the message pending so neither side forgets.

## Verify your token
\`POST /api/auth/verify\`
Returns: \`{"ok": true, "sender": "your-name"}\`
`;

export default defineEventHandler(() => {
  return new Response(DOC, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
});
