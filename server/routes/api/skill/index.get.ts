import { defineEventHandler } from "h3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let skillDoc: string;
try {
  skillDoc = readFileSync(resolve(process.cwd(), "SKILL.md"), "utf-8");
} catch {
  skillDoc = "# Hive API\n\nSKILL.md not found.";
}

const DISCOVERY = `

---

## Skill Discovery

Hive provides per-section skill docs for agents to learn specific features:

| Endpoint | Description |
|----------|-------------|
| \`GET /api/skill\` | This document — full overview |
| \`GET /api/skill/messages\` | Messaging API (send, list, ack, reply, search) |
| \`GET /api/skill/broadcast\` | Broadcast webhooks and Buzz feed |
| \`GET /api/skill/swarm\` | Task management (projects, tasks, board) |
| \`GET /api/skill/presence\` | Team presence and online status |
| \`GET /api/skill/recurring\` | Recurring task templates |
| \`GET /api/skill/monitoring\` | **Essential** — How agents should monitor Hive |

**Start here:** Read \`/api/skill/monitoring\` first to understand how to effectively participate in Hive.
`;

export default defineEventHandler(() => {
  return new Response(skillDoc + DISCOVERY, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
});
