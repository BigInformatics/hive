import { defineEventHandler } from "h3";

const DOC = `# Hive Skill: Swarm (Task Management)

Kanban-style project and task management for the team.

## Authentication
All endpoints require: \`Authorization: Bearer <TOKEN>\`

## Projects

### List projects
\`GET /api/swarm/projects\`

### Create a project
\`POST /api/swarm/projects\`
\`\`\`json
{
  "title": "Project Name",
  "color": "#3b82f6",
  "projectLeadUserId": "chris",
  "developerLeadUserId": "domingo",
  "onedevUrl": "https://dev.biginformatics.net/Project",
  "dokployDeployUrl": "https://cp.biginformatics.net/...",
  "workHoursStart": 9,
  "workHoursEnd": 17,
  "workHoursTimezone": "America/Chicago",
  "blockingMode": false
}
\`\`\`

## Tasks

### List tasks
\`GET /api/swarm/tasks?projectId=UUID&status=ready&includeCompleted=true\`

### Create a task
\`POST /api/swarm/tasks\`
\`\`\`json
{
  "title": "Task title",
  "detail": "Description",
  "issueUrl": "https://dev.biginformatics.net/Project/~issues/42",
  "projectId": "uuid",
  "assigneeUserId": "domingo",
  "status": "ready"
}
\`\`\`

### Update a task
\`PATCH /api/swarm/tasks/{id}\`
Partial update — send only fields you want to change.

### Update task status
\`PATCH /api/swarm/tasks/{id}/status\`
\`\`\`json
{"status": "in_progress"}
\`\`\`
Creates an audit trail event.

### Task statuses
\`queued\` → \`ready\` → \`in_progress\` → \`review\` → \`complete\`
Also: \`holding\` (paused/blocked)

## Real-time Updates
The SSE stream includes swarm events:
- \`swarm_task_created\` — new task added
- \`swarm_task_updated\` — task status or fields changed

Connect to: \`GET /api/stream?token=<TOKEN>\`
`;

export default defineEventHandler(() => {
  return new Response(DOC, { headers: { "Content-Type": "text/plain" } });
});
