import { defineEventHandler } from "h3";

const DOC = `# Hive Skill: Notebook (Collaborative Markdown Pages)

A shared markdown notebook for the team with **real-time collaborative editing** powered by Yjs CRDT and WebSocket.

---

## Authentication

All REST endpoints require a Bearer token in the Authorization header.
WebSocket connections pass the token as a query parameter.

---

## REST Endpoints

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

## Real-Time Collaborative Editing (WebSocket + Yjs)

The notebook supports real-time collaborative editing using [Yjs](https://yjs.dev/) CRDT over WebSocket.

### WebSocket Endpoint

\`\`\`
wss://<host>/api/notebook/ws?page=<page-id>&token=<auth-token>
\`\`\`

### Protocol

All messages are JSON.

**Server → Client:**

| type | payload | description |
|------|---------|-------------|
| \`sync\` | \`{ update: number[] }\` | Full Y.Doc state on connect. Apply with \`Y.applyUpdate()\`. |
| \`update\` | \`{ update: number[] }\` | Incremental Yjs update from another peer. Apply with \`Y.applyUpdate()\`. |
| \`viewers\` | \`{ viewers: string[] }\` | List of identities currently viewing the page. Sent on join/leave. |
| \`error\` | \`{ message: string }\` | Error (bad auth, page not found). Connection will close. |

**Client → Server:**

| type | payload | description |
|------|---------|-------------|
| \`update\` | \`{ update: number[] }\` | Local Yjs update to broadcast. Use \`Array.from(update)\` to serialize. |

### Agent Example (Node.js)

\`\`\`javascript
const WebSocket = require('ws');
const Y = require('yjs');

const ydoc = new Y.Doc();
const ytext = ydoc.getText('content');

// Send local changes to server
ydoc.on('update', (update, origin) => {
  if (origin === 'remote') return;
  ws.send(JSON.stringify({ type: 'update', update: Array.from(update) }));
});

const ws = new WebSocket('wss://host/api/notebook/ws?page=PAGE_ID&token=TOKEN');

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'sync' || msg.type === 'update') {
    Y.applyUpdate(ydoc, new Uint8Array(msg.update), 'remote');
  }
});

// Edit the document (syncs to all peers automatically)
ytext.insert(ytext.length, '\\nHello from an agent!');
\`\`\`

### Yjs Text Channel

The document content lives in the Yjs text channel named \`"content"\`:

\`\`\`javascript
const ytext = ydoc.getText('content');
ytext.toString(); // get current content
ytext.insert(pos, text); // insert at position
ytext.delete(pos, length); // delete range
\`\`\`

---

## ⚠️ Agent Gotchas for Live Editing

### 1. REST PATCH overwrites Yjs state

If a human is editing a page via the UI (WebSocket/Yjs), and an agent uses \`PATCH /api/notebook/:id\` with a \`content\` field, the REST write goes directly to the database. The in-memory Yjs doc is **not updated** — the human's next save via Yjs will overwrite the agent's REST edit.

**Rule:** If anyone might be actively editing a page, use the WebSocket/Yjs protocol instead of REST PATCH for content changes. REST PATCH is safe for \`title\`, \`taggedUsers\`, and \`locked\` fields.

### 2. Check viewers before editing

Before making content changes, check if the page has active viewers:

\`\`\`
POST /api/notebook/:id/presence
→ { "viewers": ["chris"] }
\`\`\`

If viewers are present, prefer WebSocket editing. If no viewers, REST PATCH is safe.

### 3. Yjs doc lifecycle

- The server creates an in-memory Y.Doc when the first WebSocket client connects
- The Y.Doc persists to the database with a 5-second debounce after each edit
- The Y.Doc is destroyed 10 seconds after the last client disconnects
- If no WebSocket clients are connected, the Y.Doc does not exist in memory — REST reads/writes go directly to the database

### 4. Initial sync replaces local state

When connecting via WebSocket, the server sends a \`sync\` message with the full Y.Doc state. Apply this **before** making any local edits, or your first edit may conflict.

### 5. Connection drops

If the WebSocket disconnects, unsent local Yjs updates are lost. Reconnect and the server will send a fresh \`sync\`. For critical edits, confirm the update was received (watch for the echo back as an \`update\` message, or re-read via REST).

### 6. Don't hold connections open indefinitely

Disconnect your WebSocket when done editing. Open connections keep the Y.Doc in server memory. The server destroys idle docs after 10 seconds with no peers.

---

## Page Locking

When a page is locked:
- Only the creator or an admin can edit content, title, or settings
- Other users can still view (if they have visibility access)
- The \`lockedBy\` field shows who locked it

To lock: \`PATCH /api/notebook/:id\` with \`{ "locked": true }\`
To unlock: \`PATCH /api/notebook/:id\` with \`{ "locked": false }\`
`;

export default defineEventHandler(() => {
  return new Response(DOC, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
});
