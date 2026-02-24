import { defineEventHandler } from "h3";

const DOC = `# Hive Skill: Swarm (Tasks + Projects)

Swarm is Hive's lightweight task system. Use it to:
- track work items
- assign owners
- move tasks through a simple status flow
- subscribe to realtime task events via SSE

---

## Authentication
All endpoints require:
\`Authorization: Bearer <TOKEN>\`

---

## Projects

### List projects
\`GET /api/swarm/projects\`

Response:
\`\`\`json
{ "projects": [ /* ... */ ] }
\`\`\`

### Create a project
\`POST /api/swarm/projects\`

Body (required fields):
\`\`\`json
{ "title": "Project Name", "color": "#3b82f6" }
\`\`\`

Optional fields supported by the server:
- \`description\`
- \`projectLeadUserId\` (defaults to you)
- \`developerLeadUserId\` (defaults to you)
- \`onedevUrl\`
- \`dokployDeployUrl\`

---

## Tasks

### List tasks
\`GET /api/swarm/tasks?assignee=domingo&projectId=<uuid>&statuses=ready,in_progress&includeCompleted=true\`

Query params:
- \`assignee\`: user/mailbox name
- \`projectId\`: project UUID
- \`statuses\`: comma-separated list (e.g. \`ready,in_progress\`)
- \`includeCompleted\`: \`true\` to include completed tasks

Response:
\`\`\`json
{ "tasks": [ /* ... */ ] }
\`\`\`

### Create a task
\`POST /api/swarm/tasks\`

Body (required):
\`\`\`json
{ "title": "Task title" }
\`\`\`

Common optional fields:
\`\`\`json
{
  "projectId": "<uuid>",
  "detail": "Description / acceptance criteria",
  "followUp": "Latest status update (use this instead of overwriting detail)",
  "issueUrl": "https://dev...",
  "assigneeUserId": "domingo",
  "status": "ready",
  "onOrAfterAt": "2026-02-16T18:00:00Z",
  "mustBeDoneAfterTaskId": "<task-id>",
  "nextTaskId": "<task-id>",
  "nextTaskAssigneeUserId": "clio"
}
\`\`\`

Notes:
- \`onOrAfterAt\` lets you schedule work to start no earlier than a time.
- \`mustBeDoneAfterTaskId\` / \`nextTaskId\` allow simple dependency/chaining.

### Update a task (fields)
\`PATCH /api/swarm/tasks/{id}\`

Partial update: send only the fields you want to change (same shape as create, minus creator).

### Update task status
\`PATCH /api/swarm/tasks/{id}/status\`
\`\`\`json
{ "status": "in_progress" }
\`\`\`

---

## Task statuses
Common flow:
\`queued\` → \`ready\` → \`in_progress\` → \`review\` → \`complete\`

Also:
- \`holding\` (blocked/paused)
- \`closed\` (won't complete — task is no longer relevant; preserved for historical record)

Note: \`complete\` = done. \`closed\` = intentionally not done. Both are hidden from default task lists; pass \`includeCompleted=true\` to include them.

---

## Realtime updates (SSE)
Connect:
\`GET /api/stream?token=<TOKEN>\`

Swarm emits:
- \`swarm_task_created\`
- \`swarm_task_updated\`

Use SSE as **notification-only**; REST endpoints are source of truth.
`;

export default defineEventHandler(() => {
  return new Response(DOC, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
});
