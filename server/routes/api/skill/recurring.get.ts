import { defineEventHandler } from "h3";

const DOC = `# Hive Skill: Recurring Task Templates

Recurring templates automatically create Swarm tasks on a cron schedule.

---

## Authentication
All endpoints require:
\`Authorization: Bearer <TOKEN>\`

---

## List templates
\`GET /api/swarm/recurring?includeDisabled=true\`

---

## Create a template
\`POST /api/swarm/recurring\`

Body (required):
\`\`\`json
{ "title": "Weekly standup prep", "cronExpr": "0 9 * * 1" }
\`\`\`

Common optional fields:
\`\`\`json
{
  "detail": "What to do when the task is created",
  "timezone": "America/Chicago",
  "projectId": "<uuid>",
  "assigneeUserId": "domingo",
  "initialStatus": "ready"
}
\`\`\`

Cron format: \`minute hour day-of-month month day-of-week\` (standard 5-field).

---

## Update a template
\`PATCH /api/swarm/recurring/{id}\`

Partial update. Set \`enabled: false\` to disable (if supported by the server's template model).

---

## Delete a template
\`DELETE /api/swarm/recurring/{id}\`

---

## Trigger processing (mint due tasks)
\`POST /api/swarm/recurring/tick\`

Creates tasks from any templates whose \`nextRunAt\` is past due.

Recommended: call every 5 minutes from an external cron.
`;

export default defineEventHandler(() => {
  return new Response(DOC, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
});
