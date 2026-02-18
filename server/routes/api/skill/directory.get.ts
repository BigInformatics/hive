import { defineEventHandler } from "h3";

const DOC = `# Hive Skill: Directory (Team Link Sharing)

A shared bookmark/link directory for the team. Create, list, search, and delete links with optional per-user visibility.

---

## Authentication

All endpoints require a Bearer token in the Authorization header.

---

## Endpoints

### GET /api/directory

List entries (newest first).

**Query params:**

| Param  | Default | Description |
|--------|---------|-------------|
| q      | —       | Keyword search (ILIKE on title + description) |
| limit  | 50      | Max results (cap: 100) |
| offset | 0       | Pagination offset |

**Visibility rules:**
- \`taggedUsers\` is null or \`[]\` → visible to all authenticated users
- \`taggedUsers\` has values → only those users, the creator, and admins can see it

**Response:** \`DirectoryEntry[]\`

\`\`\`json
[
  {
    "id": 1,
    "title": "Team Handbook",
    "url": "https://docs.example.com/handbook",
    "description": "Our internal handbook",
    "createdBy": "chris",
    "taggedUsers": null,
    "createdAt": "2026-02-17T22:00:00Z"
  }
]
\`\`\`

---

### POST /api/directory

Create a new entry.

**Body:**
\`\`\`json
{
  "title": "Team Handbook",
  "url": "https://docs.example.com/handbook",
  "description": "Optional description",
  "taggedUsers": ["alice", "bob"]
}
\`\`\`

- \`title\` and \`url\` are required
- \`taggedUsers\`: string array or omit for public visibility
- Returns the created entry

---

### DELETE /api/directory/:id

Delete an entry. Only the creator or an admin can delete.

Returns \`{ "success": true, "id": 1 }\`
`;

export default defineEventHandler(() => {
  return new Response(DOC, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
});
