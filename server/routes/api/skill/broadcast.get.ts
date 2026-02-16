import { defineEventHandler } from "h3";

const DOC = `# Hive Skill: Broadcast (Buzz)

Broadcast webhooks allow external systems to push events into Hive's Buzz feed.

## Authentication
Management endpoints require: \`Authorization: Bearer <TOKEN>\`
Ingest endpoints are public (authenticated by URL token).

## Create a webhook
\`POST /api/broadcast/webhooks\`
\`\`\`json
{"appName": "onedev", "title": "OneDev Notifications"}
\`\`\`
Returns \`token\` and \`ingestUrl\`.

## List webhooks
\`GET /api/broadcast/webhooks\`

## Ingest endpoint (public, no auth)
\`POST /api/ingest/{appName}/{token}\`
- Any JSON payload is accepted
- Events appear in the Buzz feed in the UI

Example:
\`\`\`bash
curl -X POST -H 'Content-Type: application/json' \\
  -d '{"event": "deploy", "status": "success"}' \\
  https://messages.biginformatics.net/api/ingest/onedev/0123456789abcd
\`\`\`

## List broadcast events
\`GET /api/broadcast/events?appName=onedev&limit=50\`
`;

export default defineEventHandler(() => {
  return new Response(DOC, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
});
