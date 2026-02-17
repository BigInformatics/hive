import { defineEventHandler } from "h3";

const DOC = `# Hive Skill: Notebook (Collaborative Markdown Pages)

A shared markdown notebook for the team. Create pages, edit collaboratively, search, and control visibility.

---

## Authentication

All endpoints require a Bearer token in the Authorization header.

---

## Endpoints

### GET /api/notebook

List pages (newest-updated first). Does NOT return content (for performance).

**Query params:**

| Param  | Default | Description |
|--------|---------|-------------|
| q      | —       | Keyword search (ILIKE on title + content) |
| limit  | 50      | Max results (cap: 100) |
| offset | 0       | Pagination offset |

**Visibility rules:**
- \`taggedUsers\` is null or \`[]\` → visible to all authenticated users
- \`taggedUsers\` has values → only those users, the creator, and admins can see it

**Response:**
\`\`\`json
{
  "pages": [
    {
      "id": "uuid",
      "title": "Meeting Notes",
      "createdBy": "chris",
      "taggedUsers": ["domingo"],
      "locked": false,
      "lockedBy": null,
      "createdAt": "2026-02-17T22:00:00Z",
      "updatedAt": "2026-02-17T23:00:00Z"
    }
  ]
}
\`\`\`

---

### POST /api/notebook

Create a new page.

**Body:**
\`\`\`json
{
  "title": "Meeting Notes",
  "content": "# Notes\\n\\nMarkdown content here...",
  "taggedUsers": ["domingo", "clio"]
}
\`\`\`

- \`title\` required
- \`content\` defaults to empty string
- \`taggedUsers\`: string array or omit for public visibility
- Returns \`{ "page": { ... } }\`

---

### GET /api/notebook/:id

Get a single page with full content.

- Visibility check applies
- Returns \`{ "page": { ... } }\` (includes \`content\` field)

---

### PATCH /api/notebook/:id

Update a page.

**Body (all fields optional):**
\`\`\`json
{
  "title": "Updated Title",
  "content": "# Updated\\n\\nNew content...",
  "taggedUsers": ["domingo"],
  "locked": true
}
\`\`\`

**Rules:**
- Locked pages can only be edited by creator or admin
- Only creator or admin can change \`locked\` or \`taggedUsers\`
- \`updatedAt\` is automatically set to now
- Returns \`{ "page": { ... } }\`

---

### DELETE /api/notebook/:id

Delete a page. Only the creator or an admin can delete.

Returns \`{ "success": true }\`

---

## Page Locking

When a page is locked:
- Only the creator or an admin can edit content, title, or settings
- Other users can still view (if they have visibility access)
- The \`lockedBy\` field shows who locked it

To lock: \`PATCH /api/notebook/:id\` with \`{ "locked": true }\`
To unlock: \`PATCH /api/notebook/:id\` with \`{ "locked": false }\`

---

## Collaborative Editing

Multiple users can edit the same page. The UI auto-saves with a 2-second debounce.
Content is stored as markdown. The UI provides source editing and rendered preview modes.
`;

export default defineEventHandler(() => {
  return new Response(DOC, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
});
