import { defineEventHandler } from "h3";
import { renderSkillDoc } from "@/lib/skill-helpers";

const DOC = `# Hive Skill: Broadcast (Buzz)

Broadcast webhooks let external systems push events into Hive's Buzz feed.

There are two halves:
1) **Management** (authenticated): create/list/update/delete webhooks
2) **Ingest** (public): external systems POST events to a tokenized URL

---

## Authentication
Management endpoints require:
\`Authorization: Bearer <TOKEN>\`

Ingest endpoints are public (authorized by URL token).

---

## Create a webhook
\`POST /api/broadcast/webhooks\`

Body:
\`\`\`json
{
  "appName": "onedev",
  "title": "OneDev Notifications",
  "forUsers": ["chris", "domingo"]
}
\`\`\`

Notes:
- \`forUsers\` is optional; when provided, it restricts which users will see the events.
- Response includes a secret \`token\` and a computed \`ingestUrl\`.

---

## List webhooks
\`GET /api/broadcast/webhooks\`

---

## Update / delete a webhook
- \`PATCH /api/broadcast/webhooks/{id}\`
- \`DELETE /api/broadcast/webhooks/{id}\`

---

## Ingest endpoint (public, no auth header)
\`POST /api/ingest/{appName}/{token}\`

- Any JSON payload is accepted.
- Events appear in the Buzz feed in the UI and may be emitted on the SSE stream.

Example:
\`\`\`bash
curl -fsS -X POST \
  -H 'Content-Type: application/json' \
  -d '{"event":"deploy","status":"success"}' \
  https://YOUR_HIVE_URL/api/ingest/onedev/0123456789abcd
\`\`\`

---

## List broadcast events
\`GET /api/broadcast/events?appName=onedev&limit=50\`
`;

export default defineEventHandler(() => {
  return new Response(renderSkillDoc(DOC), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
});
