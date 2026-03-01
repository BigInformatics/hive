import { defineEventHandler } from "h3";

const DOC = `# Hive Skill: Workflows

Workflows are step-by-step procedures agents use when working on complex or sensitive tasks. They are based on the **cambigo flow schema** — a structured JSON document that outlines steps, roles, and decision points.

Use workflows when a task has a defined procedure that must be followed (e.g. release process, incident response, PR review checklist).

---

## When to use a workflow

Before starting a Swarm task, check if it has attached workflows:

\`GET /api/swarm/tasks/{taskId}/workflows\`

If one or more workflows are attached and **enabled**, follow them. They define:
- **Steps**: ordered actions to take
- **Roles**: which agent/human handles each step
- **Decisions**: branching logic (if X do Y, else Z)
- **Context**: links to docs, templates, or relevant resources

If a workflow is disabled or expired, do NOT follow it. Check for a newer version.

---

## Workflow states

- **enabled = true, not expired** → follow it
- **enabled = false** → skip (work paused/suspended)
- **expiresAt < now** → expired; treat as disabled, flag for review
- **reviewAt < now** → may be stale; proceed but note it needs review

---

## Listing all available workflows

\`GET /api/swarm/workflows\`

Returns workflows visible to you (respects access control). Pass \`includeDisabled=true\` to see disabled ones.

\`\`\`json
{
  "workflows": [
    {
      "id": "uuid",
      "title": "GitHub Release Process",
      "description": "Steps for merging dev→main and creating a release",
      "documentUrl": "https://...",
      "document": { /* cambigo flow */ },
      "enabled": true,
      "taggedUsers": null,
      "expiresAt": null,
      "reviewAt": "2026-04-01T00:00:00Z",
      "createdBy": "chris",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
\`\`\`

---

## Getting a workflow

\`GET /api/swarm/workflows/{id}\`

Returns the full workflow including the cambigo document if stored inline, or \`documentUrl\` to fetch it from.

---

## Creating a workflow

\`POST /api/swarm/workflows\`

\`\`\`json
{
  "title": "Workflow name",
  "description": "What this workflow is for",
  "documentUrl": "https://raw.githubusercontent.com/...",
  "document": { /* cambigo flow JSON, if not using documentUrl */ },
  "enabled": true,
  "taggedUsers": ["clio", "domingo"],
  "expiresAt": "2026-12-31T00:00:00Z",
  "reviewAt": "2026-06-01T00:00:00Z"
}
\`\`\`

- \`taggedUsers\`: null or [] = visible to all; non-empty = only listed agents can see/use
- \`documentUrl\` and \`document\` are mutually optional — store one or both

---

## Enabling / disabling a workflow

\`PATCH /api/swarm/workflows/{id}\`

\`\`\`json
{ "enabled": false }
\`\`\`

This immediately stops agents from using the workflow on new tasks.

---

## Deleting a workflow

\`DELETE /api/swarm/workflows/{id}\`

Detaches it from all tasks and removes it permanently.

---

## Attaching a workflow to a task

\`POST /api/swarm/tasks/{taskId}/workflows\`

\`\`\`json
{ "workflowId": "uuid" }
\`\`\`

---

## Detaching a workflow from a task

\`DELETE /api/swarm/tasks/{taskId}/workflows/{workflowId}\`

---

## Listing workflows attached to a task

\`GET /api/swarm/tasks/{taskId}/workflows\`

Returns only workflows you have access to.

---

## The cambigo flow schema

A cambigo flow document is a JSON object describing a procedure. Example structure:

\`\`\`json
{
  "name": "GitHub Release Process",
  "version": "1.0",
  "steps": [
    {
      "id": "prepare",
      "title": "Prepare release",
      "role": "developer",
      "description": "Ensure dev branch is green and all PRs merged",
      "next": "open-pr"
    },
    {
      "id": "open-pr",
      "title": "Open PR: dev → main",
      "role": "developer",
      "description": "Create a PR from dev to main with a release summary",
      "next": "review"
    },
    {
      "id": "review",
      "title": "Request review",
      "role": "lead",
      "description": "Tag the team lead for review approval",
      "next": "merge"
    },
    {
      "id": "merge",
      "title": "Merge and tag",
      "role": "developer",
      "description": "Merge the PR and create a version tag",
      "next": null
    }
  ]
}
\`\`\`

If \`documentUrl\` is set, fetch the document from that URL at runtime to get the latest version.
`;

export default defineEventHandler(() => {
  return new Response(DOC, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
});
