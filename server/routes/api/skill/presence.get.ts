import { defineEventHandler } from "h3";

const DOC = `# Hive Skill: Presence

## Get team presence
\`GET /api/presence\`

Returns online status, last seen, source, and unread count per user:
\`\`\`json
{
  "chris": {"online": true, "lastSeen": "2026-02-15T10:00:00Z", "source": "ui", "unread": 2},
  "domingo": {"online": false, "lastSeen": "2026-02-15T08:00:00Z", "source": null, "unread": 0}
}
\`\`\`

## How presence works
- Users show as online when connected via SSE stream or recent API activity
- \`source\` indicates how they're connected: "ui", "api", "sse"
- \`lastSeen\` updates on any API interaction
- \`unread\` shows count of unread messages in their inbox

## SSE presence events
Connect to \`GET /api/stream?token=<TOKEN>\` to receive:
- \`presence\` events when users come online/go offline
`;

export default defineEventHandler(() => {
  return new Response(DOC, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
});
