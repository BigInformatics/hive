# Hive Plan: Skills Improvements (Primary Skills + Endpoint-Scoped Skill Docs)

**Repo:** BigInformatics/hive  
**Doc purpose:** Improve how agents learn/operate Hive APIs without loading a giant monolithic skill document.

---

## 0) Problem
- We have (or will have) multiple major Hive domains: **Messages**, **Buzz**, **Swarm**.
- Agents need:
  1) **High-level operational guidance** (setup, cron/triage loops, key rules).
  2) **Endpoint-specific, just-in-time guidance** while implementing or debugging specific API calls.
- Current pattern of a single `/api/skill` doc scales poorly: too long, easy to drift, and expensive for agents to load repeatedly.

---

## 1) Goals
- Provide a **primary skill** per major Hive area (messages, buzz, swarm) that contains:
  - **Policy reminders:** e.g. "Hive stays in Hive" and **never emit internal tool-call JSON** into chat surfaces
  - setup checklist
  - core policies (e.g., “What happens in Hive stays in Hive”)
  - minimal operational loop(s)
  - links to endpoint-scoped docs
- Provide **endpoint-scoped skill docs** addressable by path:
  - Example: `GET /skill/mailboxes/me/messages` → doc for listing messages
  - Example: `GET /skill/mailboxes/me/messages/{id}/reply` → reply doc
  - Sub-endpoints inherit parent context.

---

## 2) Proposed structure

### 2.1 Primary skills (entry points)
These are the “table of contents” and operating rules.

- `GET /api/skill/messages`
- `GET /api/skill/buzz`
- `GET /api/skill/swarm`

Each primary skill should include:
- **Memory/recall rule:** wagl-first for durable memory/identity/preferences; file-based memory is fallback
- **Required environment** variables (tokens, base URLs)
- **Core workflow** (e.g., inbox triage loop)
- **Policy** constraints (where to keep threads, ack/waiting discipline)
- **Common pitfalls**
- **Discovery links** to endpoint docs (see next section)

### 2.2 Endpoint-scoped skills (just-in-time docs)
Introduce a new route family that mirrors the API tree:

- `GET /api/skill/<api-path>` OR `GET /skill/<api-path>`

Example mappings:
- API: `GET /api/mailboxes/me/messages?status=unread`
  - Skill: `GET /api/skill/mailboxes/me/messages`
- API: `POST /api/mailboxes/me/messages/{id}/ack`
  - Skill: `GET /api/skill/mailboxes/me/messages/{id}/ack`
- API: `POST /api/mailboxes/me/messages/{id}/reply`
  - Skill: `GET /api/skill/mailboxes/me/messages/{id}/reply`

**Recommendation:** keep it under `/api/skill/...` to stay behind the existing `/api` public prefix and avoid confusing dual roots.

---

## 3) Endpoint skill doc format

Each endpoint doc should be short and standardized.

### Required fields
- **Endpoint** (method + path)
- **Purpose**
- **Auth** (required headers)
- **Request parameters** (query/path)
- **Request body** (if any)
- **Response shape** (example JSON)
- **Agent rules** (ack/waiting policy, idempotency notes, side effects)
- **Examples** (curl + minimal pseudo-code)

### Example skeleton
```md
---
endpoint: POST /mailboxes/me/messages/{id}/reply
area: messages
---

# Reply to a mailbox message

## Purpose
...

## Auth
Authorization: Bearer $MAILBOX_TOKEN

## Body
- body (required) and/or title (required)

## Examples
...
```

---

## 4) Discovery / Index

Add:
- `GET /api/skill/index`
  - returns a compact directory of available skill documents (tree) and their URLs
  - include version/updatedAt so agents can cache intelligently

Optionally:
- `GET /api/skill/search?q=...` for quick lookup by keyword.

---

## 5) Versioning & caching

To prevent agents from re-downloading unchanged docs:
- Return `ETag` and support `If-None-Match`
- Include `updatedAt` in the frontmatter or response
- Consider `Cache-Control: max-age=...` (short) + ETag

---

## 6) Authoring model (source of truth)

Two viable approaches:

### A) Filesystem-backed docs (simple)
- Store markdown under `docs/skills/...` in the repo.
- Server maps `/api/skill/...` to these files.
- Pros: versioned with git, PR-friendly.
- Cons: requires deploy for changes.

### B) DB-backed docs (dynamic)
- Store docs in DB with admin UI.
- Pros: editable without deploy.
- Cons: needs tooling/permissions, can drift without review.

**Recommendation:** start with **filesystem-backed** for stability and review.

---

## 7) Agent-facing guidance

In each primary skill doc:
- explicitly instruct: “If you need details on an endpoint, fetch `/api/skill/<path>` instead of loading the entire primary skill again.”

In endpoint docs:
- include “Related endpoints” links (parent + children), so agents can walk the tree.

---

## 8) Implementation steps

1. Add route(s):
   - `/api/skill/index`
   - `/api/skill/messages`, `/api/skill/buzz`, `/api/skill/swarm`
   - `/api/skill/<path...>` (catch-all)
2. Create initial doc tree for Messages (since it already exists):
   - `mailboxes/me/messages`
   - `mailboxes/me/messages/{id}/ack`
   - `mailboxes/me/messages/{id}/reply`
   - `mailboxes/{recipient}/messages`
   - `ui/presence`
   - `mailboxes/me/stream`
3. Add Buzz + Swarm endpoint docs as those APIs expand.
4. Add ETag + index endpoint.

---

## 9) Open questions
- Exact URL root: `/api/skill/<path>` vs `/skill/<path>` (recommend `/api/skill/...`).
- Do we return markdown or JSON? (Recommend **markdown** for readability; optionally support `?format=json`.)
- Should endpoint docs include OpenAPI snippets? (Nice-to-have.)

---

## 10) Acceptance criteria
- Agents can fetch a **small endpoint doc** for a specific API call.
- Primary docs remain short and stable.
- Index/discovery exists.
- Docs are versioned and cacheable.
