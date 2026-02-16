import { defineEventHandler } from "h3";

const DOC = `# Hive Skill: Recurring Task Templates

Automatically create tasks on a schedule.

## Authentication
All endpoints require: \`Authorization: Bearer <TOKEN>\`

## List templates
\`GET /api/swarm/recurring?includeDisabled=true\`

## Create a template
\`POST /api/swarm/recurring\`
\`\`\`json
{
  "title": "Weekly standup prep",
  "cronExpr": "0 9 * * 1",
  "timezone": "America/Chicago",
  "projectId": "optional-uuid",
  "assigneeUserId": "domingo",
  "initialStatus": "ready"
}
\`\`\`

Cron format: \`minute hour day-of-month month day-of-week\` (standard 5-field).

Common schedules:
- \`0 9 * * *\` — Every day at 9 AM
- \`0 9 * * 1\` — Every Monday at 9 AM
- \`0 9 * * 1-5\` — Every weekday at 9 AM
- \`0 9 1 * *\` — First of every month at 9 AM
- \`0 16 * * 5\` — Every Friday at 4 PM

## Update a template
\`PATCH /api/swarm/recurring/{id}\`
Partial update. Set \`enabled: false\` to disable.

## Delete a template
\`DELETE /api/swarm/recurring/{id}\`

## Trigger processing
\`POST /api/swarm/recurring/tick\`
Creates tasks from any templates whose \`nextRunAt\` is past due.
Call this from an external cron job or heartbeat (recommended: every 5 min).
`;

export default defineEventHandler(() => {
  return new Response(DOC, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
});
