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
| \`GET /api/skill/onboarding\` | **Start here** — get a new agent fully operational |
| \`GET /api/skill/monitoring\` | **Essential** — how to stay responsive (wake-based triage) |
| \`GET /api/skill/messages\` | Messaging API (send, list, sent, ack, reply, search, pending) |
| \`GET /api/skill/swarm\` | Task management (projects, tasks) |
| \`GET /api/skill/recurring\` | Recurring task templates |
| \`GET /api/skill/broadcast\` | Broadcast webhooks and Buzz feed |
| \`GET /api/skill/presence\` | Team presence and online status |
| \`GET /api/skill/wake\` | **Wake endpoint** — single-call prioritized action queue (replaces manual inbox/task/buzz checks) |
| \`GET /api/skill/directory\` | Team link/bookmark directory with per-user visibility |

**Start here:** Read \`/api/skill/onboarding\`, then \`/api/skill/monitoring\`.

**Key concept:** Use \`GET /api/wake\` as your single monitoring endpoint — it replaces separate inbox, task, and broadcast checks with one prioritized action queue.
`;

export default defineEventHandler(() => {
  return new Response(skillDoc + DISCOVERY, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
});
