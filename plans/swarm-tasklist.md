# Hive Plan: Swarm (Task List) + Projects

**Repo:** Team/hive  
**Doc purpose:** Detailed implementation plan for adding a new Hive tab **Swarm**: a timeline-style task list (not kanban) with full API control, and a companion **Projects** model. Updates broadcast into Buzz.

---

## 0) Goals / Non-goals

### Goals
- Add a new top-level UI tab: **Swarm**.
- Provide an API for creating/updating/querying tasks and projects.
- Tasks support:
  - assignment and unassigned tasks
  - dependency constraint ("must be done after")
  - scheduling constraint ("on or after")
  - explicit planned ordering ("next issues at the top")
  - lifecycle statuses: `queued`, `ready`, `in_progress`, `holding`, `review`, `complete`
- UI is **timeline/list view**, consistent with existing **Messages** and **Buzz** look/feel (not kanban).
- Tasks are filterable by status and user (multi-select checkbox listbox style).
- Changes to tasks/projects produce **Buzz events**.

### Non-goals (initial MVP)
- Full kanban/drag-drop boards.
- Complex dependency graphs (support single `mustBeDoneAfterTaskId` per task first).
- Cross-project milestones, Gantt charts.

---

## 1) UX / UI (match existing Hive standards)

### Look & feel standards
- Use the same page scaffolding as Messages/Buzz:
  - left filter rail
  - main list (timeline rows)
  - right detail drawer (or panel) for editing/viewing
- Reuse existing components where possible:
  - list row layout, hover actions, selection highlight
  - pills/badges for status
  - avatar stack + user chips
  - empty states and loading skeletons
- No large new layout paradigms; keep it "Hive-native".

### Navigation
- Add a top-level tab: **Swarm**.
- URL routes (suggested):
  - `/swarm` list
  - `/swarm/task/:id` deep link into task detail
  - optionally `/swarm/project/:id` if we add project pages later

### Swarm list layout
- **Left rail** (filters):
  - Status (multi-select checkbox listbox)
  - Assignee (multi-select checkbox listbox; include **Unassigned**)
  - Project (multi-select checkbox listbox; include **No project**)
  - Optional: Creator (multi-select)
  - Toggle: Show future (includes tasks with `onOrAfterAt > now`)
  - Toggle: Show completed
  - Sort:
    - Planned (default)
    - Created time (asc/desc)
    - Updated time (asc/desc)
- **Main list**: timeline rows
  - left accent bar color = project color (if `projectId` set)
  - title (primary)
  - small secondary line: project name, assignee, onOrAfter badge, dependency badge
  - status pill
  - quick actions (inline on hover): Claim, Start, Hold, Review, Complete
- **Detail drawer**:
  - editable fields
  - history/events section (if implemented)
  - dependency linking UI: "Must be done after" selector
  - "Next task" linking UI

### Task list ordering (timeline, not kanban)
Support two key sort modes:

#### A) Planned ordering (default)
A stable ordering that prioritizes what’s next and active:
1. Bucket by status in this order:
   1) `in_progress`
   2) `review`
   3) `ready`
   4) `queued`
   5) `holding`
   6) `complete`
2. Within bucket:
   - `sortKey` ASC (nulls last)
   - `onOrAfterAt` ASC (nulls last)
   - `createdAt` ASC

#### B) Time ordering
- `createdAt` or `updatedAt` with asc/desc.

### Row badges / indicators
- **Blocked** indicator when:
  - `mustBeDoneAfterTaskId` exists and referenced task is not complete, OR
  - `onOrAfterAt` in the future
- **On or after** badge showing date/time when present
- **Dependency** link badge, clickable to the other task

---

## 2) Domain model

### Status enum
- `queued`
- `ready`
- `in_progress`
- `holding`
- `review`
- `complete`

### Computed fields
- `blockedReason` (not stored): `dependency` | `on_or_after` | null
- `eligible` (not stored): true if not blocked and status in {queued, ready}

---

## 3) Data model (DB)

### 3.1 Projects
Table: `swarm_projects`
- `id` uuid PK
- `title` text NOT NULL
- `description` text NULL
- `oneDevUrl` text NULL
- `dokployDeployUrl` text NULL
- `color` text NOT NULL (hex `#RRGGBB`, validated)
- `projectLeadUserId` (fk users) NOT NULL
- `developerLeadUserId` (fk users) NOT NULL
- `archivedAt` timestamptz NULL
- `createdAt` timestamptz NOT NULL
- `updatedAt` timestamptz NOT NULL

Indexes:
- `archivedAt`
- `title` (optional)

### 3.2 Tasks
Table: `swarm_tasks`
- `id` uuid PK
- `projectId` uuid NULL FK swarm_projects(id)
- `title` text NOT NULL
- `detail` text NULL
- `creatorUserId` (fk users) NOT NULL
- `assigneeUserId` (fk users) NULL
- `status` swarm_task_status NOT NULL
- `onOrAfterAt` timestamptz NULL
- `mustBeDoneAfterTaskId` uuid NULL FK swarm_tasks(id)
- `sortKey` bigint NULL (or numeric)  
- `nextTaskId` uuid NULL FK swarm_tasks(id)
- `nextTaskAssigneeUserId` uuid NULL FK users(id)
- `createdAt` timestamptz NOT NULL
- `updatedAt` timestamptz NOT NULL
- `completedAt` timestamptz NULL

Indexes:
- `status`
- `assigneeUserId`
- `projectId`
- `onOrAfterAt`
- `sortKey`

### 3.3 Events (recommended)
Table: `swarm_task_events`
- `id` uuid PK
- `taskId` uuid NOT NULL
- `actorUserId` uuid NOT NULL
- `kind` text NOT NULL (created|updated|status_changed|assigned|reordered|etc)
- `before` jsonb NULL
- `after` jsonb NULL
- `createdAt` timestamptz NOT NULL

Used for:
- audit trail
- rendering detail history
- creating Buzz entries reliably

---

## 4) API design

Namespace: `/api/swarm`

### 4.1 Projects
- `GET /swarm/projects?archived=false`
- `POST /swarm/projects`
  - body: title, description?, oneDevUrl?, dokployDeployUrl?, color, projectLeadUserId, developerLeadUserId
- `GET /swarm/projects/:id`
- `PATCH /swarm/projects/:id`
  - partial update
- `POST /swarm/projects/:id/archive`
- `DELETE /swarm/projects/:id/archive`

### 4.2 Tasks
- `GET /swarm/tasks`
  - filters (multi supported):
    - `status=queued&status=ready...`
    - `assignee=<id>&assignee=<id>` (plus sentinel `unassigned=true`)
    - `project=<id>&project=<id>` (plus sentinel `noProject=true`)
    - `creator=<id>`
    - `q=<text>` (title/detail search)
  - behavior:
    - `includeFuture=true|false` (default false)
    - `includeCompleted=true|false` (default false)
  - sorting:
    - `sort=planned|createdAt|updatedAt`
    - `dir=asc|desc`
  - pagination: `limit`, `cursor`

- `POST /swarm/tasks`
  - body:
    - title (required)
    - detail?
    - projectId?
    - assigneeUserId?
    - status? (default `queued`)
    - onOrAfterAt?
    - mustBeDoneAfterTaskId?
    - sortKey?
    - nextTaskId?
    - nextTaskAssigneeUserId?

- `GET /swarm/tasks/:id`
- `PATCH /swarm/tasks/:id`
  - partial update of any editable field

- `POST /swarm/tasks/:id/claim`
  - sets `assigneeUserId = currentUser`

- `POST /swarm/tasks/:id/status`
  - body: `{ status }` (optional note)

- `POST /swarm/tasks/:id/reorder`
  - body: `{ sortKey }` OR `{ beforeTaskId }` (choose one approach)

---

## 5) Business rules / validation

### Dependencies
- If `mustBeDoneAfterTaskId` is set and referenced task is not complete:
  - task is **blocked**
  - server should prevent transition into `in_progress`, `review`, `complete` (unless admin override)

### On-or-after
- If `onOrAfterAt > now`:
  - task is **blocked** until time passes

### Completion
- On `status=complete`:
  - set `completedAt=now`

### Next task assignee default
- If `nextTaskAssigneeUserId` is null:
  - default at read time to the current task’s `assigneeUserId`

---

## 6) Buzz integration

Every important change should emit a Buzz item.

### Events
- `swarm.task.created`
- `swarm.task.updated`
- `swarm.task.status_changed`
- `swarm.task.assigned`
- `swarm.task.reordered`
- `swarm.task.completed`

Projects:
- `swarm.project.created`
- `swarm.project.updated`
- `swarm.project.archived`

### Payload (recommended)
Include:
- `taskId`
- `projectId`
- `title`
- `actor`
- `assignee`
- `status`
- `diffSummary` (short)

Buzz item should deep-link to `/swarm/task/:id`.

---

## 7) Permissions

Baseline rules (adjust as needed):
- Any authenticated user:
  - view/list tasks/projects
  - create tasks
- Creator or assignee:
  - edit task fields, update status
- Project Lead:
  - can mark tasks `review`/`complete` (optional enforcement)
- Developer Lead:
  - can change task to `in_progress`/`holding` and manage reorder (optional enforcement)
- Admin:
  - override blocks and edit anything

---

## 8) Implementation steps (phased)

### Phase 0 — Schema + API skeleton
- Add migrations for `swarm_projects`, `swarm_tasks`, `swarm_task_events`
- Implement CRUD endpoints (projects + tasks)
- Implement list endpoint with filters + planned ordering
- Emit Buzz events on create/update/status/assign

### Phase 1 — Swarm UI MVP
- Add Swarm tab
- List view + detail drawer
- Filters: status/assignee/project
- Task create + task edit
- Color accent bar from project color

### Phase 2 — Constraints + polish
- Blocked indicators for dependency + on-or-after
- Prevent invalid transitions client-side + enforce server-side
- Preset views (My tasks, Ready next, Unassigned)

### Phase 3 — Next-task linking + reorder UX
- Next task linking UI
- Reorder controls (buttons or drag/drop if consistent with Hive UI)

---

## 9) Open questions (need decisions)
1. Do we want `holding` to mean "blocked" or "paused"? (We already compute blocked; holding can be manual.)
2. Should completion be reversible (complete → review/in_progress)?
3. Should dependency allow multiple prerequisites later (future), or keep single prerequisite forever?
4. Reordering: do we prefer absolute `sortKey` editing or relative "move before" semantics?

---

## 10) Acceptance checklist
- Swarm tab appears and matches existing Hive visual system.
- Can create/edit tasks, including project selection and later project change.
- Can filter by status/assignee/project with multi-select checkboxes.
- Planned sort places in-progress/review/ready at top.
- Blocked tasks clearly indicated.
- Buzz receives readable events for task/project changes.
