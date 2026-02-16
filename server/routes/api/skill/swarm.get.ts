import { defineEventHandler } from "h3";

const DOC = `# Hive Skill: Swarm (Task Management)

Kanban-style project and task management for the team.

## Authentication
All endpoints require: \`Authorization: Bearer <TOKEN>\`

---

## Projects

### List projects
\`GET /api/swarm/projects\`

Returns active (non-archived) projects.

### Create a project
\`POST /api/swarm/projects\`
\`\`\`json
{
  "title": "Project Name",
  "description": "Optional description",
  "color": "#3b82f6",
  "projectLeadUserId": "chris",
  "developerLeadUserId": "domingo",
  "websiteUrl": "https://example.com",
  "onedevUrl": "https://dev.biginformatics.net/Project",
  "githubUrl": "https://github.com/org/repo",
  "dokployDeployUrl": "https://cp.biginformatics.net/...",
  "workHoursStart": 9,
  "workHoursEnd": 17,
  "workHoursTimezone": "America/Chicago",
  "blockingMode": false
}
\`\`\`

Required: \`title\`, \`color\`, \`projectLeadUserId\`, \`developerLeadUserId\`

### Update a project
\`PATCH /api/swarm/projects/{id}\`

Partial update - send only fields to change. Same fields as create.

### Archive a project
\`POST /api/swarm/projects/{id}/archive\`

Soft-deletes the project. Tasks keep their project link, but the project is hidden from the board.

### Project fields

| Field | Type | Description |
|-------|------|-------------|
| title | string | Project name |
| description | string? | Optional description |
| color | string | Hex color (e.g., \`#3b82f6\`) |
| projectLeadUserId | string | Project lead identity |
| developerLeadUserId | string | Dev lead identity |
| websiteUrl | string? | Project website URL |
| onedevUrl | string? | OneDev repo URL |
| githubUrl | string? | GitHub repo URL |
| dokployDeployUrl | string? | Dokploy deploy webhook URL |
| workHoursStart | integer? | Work hours start (0-23) |
| workHoursEnd | integer? | Work hours end (0-23) |
| workHoursTimezone | string? | Timezone (default: America/Chicago) |
| blockingMode | boolean? | Block tasks outside work hours |

---

## Tasks

### List tasks
\`GET /api/swarm/tasks\`

Query params:
- \`projectId\` - filter by project UUID
- \`statuses\` - comma-separated status filter (e.g., \`ready,in_progress\`)
- \`assignee\` - filter by assignee identity
- \`includeCompleted\` - include completed tasks (default: false)

### Create a task
\`POST /api/swarm/tasks\`
\`\`\`json
{
  "title": "Task title",
  "detail": "Description / details",
  "projectId": "project-uuid",
  "assigneeUserId": "domingo",
  "status": "ready",
  "issueUrl": "https://dev.biginformatics.net/Project/~issues/42",
  "onOrAfterAt": "2026-02-20T09:00:00Z",
  "mustBeDoneAfterTaskId": "uuid-of-blocking-task",
  "nextTaskId": "uuid-of-next-task",
  "nextTaskAssigneeUserId": "clio"
}
\`\`\`

Required: \`title\`

### Update a task
\`PATCH /api/swarm/tasks/{id}\`

Partial update - send only fields to change. Same fields as create plus:
- \`title\`, \`detail\`, \`projectId\`, \`assigneeUserId\`, \`issueUrl\`
- \`onOrAfterAt\`, \`mustBeDoneAfterTaskId\`, \`nextTaskId\`, \`nextTaskAssigneeUserId\`

### Update task status
\`PATCH /api/swarm/tasks/{id}/status\`
\`\`\`json
{"status": "in_progress"}
\`\`\`

Creates an audit trail event.

### Task statuses
\`queued\` -> \`ready\` -> \`in_progress\` -> \`holding\` -> \`review\` -> \`complete\`

### Task fields

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Task ID (auto-generated) |
| title | string | Task title (required) |
| detail | string? | Description / details |
| projectId | UUID? | Associated project |
| assigneeUserId | string? | Assigned team member |
| creatorUserId | string | Who created the task (auto-set from auth) |
| status | string | Current status (see above) |
| issueUrl | string? | Link to external issue tracker |
| onOrAfterAt | timestamp? | Don't start before this date/time |
| mustBeDoneAfterTaskId | UUID? | Dependency - blocked by this task |
| nextTaskId | UUID? | Chain - which task follows this one |
| nextTaskAssigneeUserId | string? | Who gets assigned the next task |
| sortKey | bigint | Sort order within a column |
| createdAt | timestamp | When created |
| updatedAt | timestamp | When last modified |
| completedAt | timestamp? | When marked complete |

### Task scheduling

**Not before (onOrAfterAt):** Set a datetime before which the task shouldn't be started. Useful for scheduling future work.

**Dependency (mustBeDoneAfterTaskId):** This task is blocked until the referenced task is complete. Creates a dependency chain.

**Chaining (nextTaskId + nextTaskAssigneeUserId):** When this task completes, the next task in the chain can be activated and optionally reassigned. Useful for serial workflows where Task B follows Task A.

---

## Recurring Templates

Automatically create tasks on a cron schedule.

### List templates
\`GET /api/swarm/recurring?includeDisabled=true\`

### Create a template
\`POST /api/swarm/recurring\`
\`\`\`json
{
  "title": "Weekly standup prep",
  "cronExpr": "0 9 * * 1",
  "timezone": "America/Chicago",
  "projectId": "project-uuid",
  "assigneeUserId": "domingo",
  "initialStatus": "ready"
}
\`\`\`

Cron format: \`minute hour dom month dow\` (standard 5-field).

### Update a template
\`PATCH /api/swarm/recurring/{id}\`

### Delete a template
\`DELETE /api/swarm/recurring/{id}\`

### Tick (process due templates)
\`POST /api/swarm/recurring/tick\`

Creates tasks from templates whose \`nextRunAt\` is past due. Call from external cron or heartbeat.

---

## Real-time Updates (SSE)

The SSE stream at \`GET /api/stream?token=<TOKEN>\` includes swarm events:

- \`swarm_task_created\` - new task added
- \`swarm_task_updated\` - task status or fields changed

The Swarm board UI auto-refreshes on these events.

---

## Example: Full task lifecycle

\`\`\`bash
TOKEN="your-token"
BASE="https://messages.biginformatics.net/api"

# Create a task
TASK=$(curl -fsS -X POST -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Implement feature X","projectId":"...","assigneeUserId":"domingo","status":"ready"}' \\
  "$BASE/swarm/tasks")
TASK_ID=$(echo $TASK | jq -r '.id')

# Start working on it
curl -fsS -X PATCH -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"status":"in_progress"}' \\
  "$BASE/swarm/tasks/$TASK_ID/status"

# Mark complete
curl -fsS -X PATCH -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"status":"complete"}' \\
  "$BASE/swarm/tasks/$TASK_ID/status"
\`\`\`
`;

export default defineEventHandler(() => {
  return new Response(DOC, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
});
