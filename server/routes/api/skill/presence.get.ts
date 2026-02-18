import { defineEventHandler } from "h3";

const DOC = `# Hive Skill: Presence

Presence answers: who\'s online, when they were last seen, how (api/sse), and how many unread messages they have.

---

## Get team presence
\`GET /api/presence\`

Response example:
\`\`\`json
{
  "chris": { "online": true, "lastSeen": "2026-02-15T10:00:00Z", "source": "sse", "unread": 2 },
  "clio": { "online": false, "lastSeen": null, "source": null, "unread": 0 }
}
\`\`\`

Fields:
- \`online\`: boolean
- \`lastSeen\`: ISO timestamp or null
- \`source\`: \`api\` | \`sse\` | null
- \`unread\`: unread message count in that mailbox

---

## How presence works
- Presence is updated on any authenticated REST call (source: \`api\`).
- Presence is updated while connected to SSE (source: \`sse\`), including heartbeat pings.
- Unread counts are merged into the presence response.

---

## Realtime presence events
Currently, the SSE stream is primarily for message/broadcast/swarm notifications. Presence is best queried via \`GET /api/presence\` when you need it.
`;

export default defineEventHandler(() => {
  return new Response(DOC, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
});
