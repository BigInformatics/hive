# Hive Plan (Phase 2): Swarm Recurring Tasks

**Repo:** BigInformatics/hive  
**Doc purpose:** Phase 2 design for **recurring tasks** in the Swarm task list system.

This plan extends the Phase 1 Swarm timeline model with a **flexible recurrence engine**, while keeping the UI consistent with Hive’s existing Messages/Buzz style.

---

## 0) Summary

We will add the ability to define a **recurrence rule** for a task so that Hive can:
- generate future task instances automatically (or on-demand)
- support very flexible schedules (every N units, days of week, odd/even weeks, start/end, repeat count)
- carry operational ownership (primary agent, fallback agent, owner notifications)
- support muting

The Swarm tab remains a **timeline/list**. Recurring tasks are represented as:
- a **template** (recurrence definition)
- a set of **instances** (actual actionable tasks, with normal statuses)

---

## 1) Terminology

- **Template**: a recurring definition; not itself “done”.
- **Instance**: a concrete task created from a template (acts like a normal Swarm task).
- **Schedule**: the recurrence rule + bounds.

---

## 2) Product requirements (from Chris)

Recurring criteria fields:
- Repeat N times
- Interval (e.g., `1d`, `1m`, `6m`, etc) – flexible
- Start on
- End on
- Every N [minutes/hours/days/weeks/months]
- Days of week
- Odd/Even weeks (“every other week”) — recommend approach
- **Between the hours of** (optional; supports overnight windows)
- Primary agent
- Fallback agent
- Owner (notified when problems)
- Mute (y/n)

---

## 3) Recommended recurrence model (keep it flexible)

### 3.1 Two recurrence representations
We should support BOTH:

**A) Structured rule (preferred)**
A normalized recurrence rule that’s easy to validate and query:
- `every`: `{ interval: number, unit: "minute"|"hour"|"day"|"week"|"month" }`
- `daysOfWeek`: `["mon","tue",...]` (optional)
- `weekParity`: `"any"|"odd"|"even"` (optional)
- `startAt` (required)
- `endAt` (optional)
- `count` (optional) – repeat N times

**B) Duration shorthand (UI convenience)**
Accept strings like `"6m"`, `"1d"`, `"90m"` as a convenience layer, translated into the structured rule.

Rationale: we keep storage + core logic structured, while allowing a compact input format.

### 3.2 Odd/Even weeks recommendation
We need a deterministic definition:
- Use **ISO week number** (1–53) derived from the instance’s scheduled date in the chosen timezone.
- `odd` = ISO week % 2 == 1
- `even` = ISO week % 2 == 0

This supports “every other week” reliably.

### 3.3 Timezone
Pick one canonical timezone for scheduling evaluation:
- Default: **America/Chicago** (matches org policy used elsewhere)
- Store on the template: `timezone` (string, default `America/Chicago`)

### 3.4 Evaluation rules (timezone, DST, between-hours)

To avoid inconsistent instance generation, recurrence evaluation MUST be deterministic:

- **Template timezone:** all schedule evaluation happens in the template's `timezone` (IANA string). Convert to UTC only for storage/queries.
- **Between-hours window:** interpreted in template local wall-clock time.
  - `betweenHoursStart` is inclusive; `betweenHoursEnd` is exclusive.
  - If `start < end`: allowed hours are `[start, end)`.
  - If `start > end`: overnight window, allowed hours are `[start, 24) ∪ [0, end)`.
  - If `start == end`: treat as **no restriction (24h allowed)** to avoid footguns.
- **Week parity:** compute ISO week number in template timezone for the candidate local date.
- **DST handling:**
  - If a candidate local time is **missing** (spring-forward gap), **roll forward** to the next valid time — ensure nothing is missed.
  - If a candidate local time is **ambiguous** (fall-back repeated hour), choose the **earlier** occurrence and rely on unique constraint to prevent duplicates.
  - Store all times in **UTC** internally; display in local time on interfaces.

> **Decision (2026-02-03, Chris):** Roll-forward for spring-forward (don't skip); unique constraint prevents fall-back duplicates.

Add tests for DST boundaries and week parity in `America/Chicago`.

---

## 4) Data model changes (DB)

### 4.1 Recurring templates table
Add table: `swarm_recurring_templates`
- `id` uuid PK
- `projectId` uuid NULL FK swarm_projects
- `title` text NOT NULL
- `detail` text NULL

Ownership + routing:
- `primaryAgent` text NULL (agent id/name)
- `fallbackAgent` text NULL
- `ownerUserId` uuid NOT NULL FK users  -- required for accountability; if omitted at create time, default to project lead
- `mute` boolean NOT NULL default false
- `muteInterval` text NULL  -- optional, e.g. "6h", "1d"; throttles notifications/buzz for this template

Schedule definition:
- `timezone` text NOT NULL default 'America/Chicago'
- `startAt` timestamptz NOT NULL
- `endAt` timestamptz NULL
- `count` int NULL  -- Repeat N times
- `everyInterval` int NOT NULL
- `everyUnit` text NOT NULL  -- minute|hour|day|week|month
- `daysOfWeek` text[] NULL  -- e.g. {mon,tue}
- `weekParity` text NOT NULL default 'any'  -- any|odd|even
- `betweenHoursStart` int NULL  -- 0-23 local hour (inclusive)
- `betweenHoursEnd` int NULL    -- 0-23 local hour (exclusive); supports overnight windows when end < start

Operational state:
- `enabled` boolean NOT NULL default true
- `lastRunAt` timestamptz NULL
- `nextRunAt` timestamptz NULL  -- computed & cached for quick list; if `enabled=false`, set `nextRunAt=NULL`
- `createdAt` timestamptz NOT NULL
- `updatedAt` timestamptz NOT NULL

Indexes:
- `(enabled, nextRunAt)`
- `projectId`
- `ownerUserId`

### 4.2 Instance linkage
Add to `swarm_tasks`:
- `recurringTemplateId` uuid NULL FK swarm_recurring_templates(id)
- `recurringInstanceAt` timestamptz NULL (the scheduled time for this instance)

Uniqueness guard (avoid duplicates):
- unique index on `(recurringTemplateId, recurringInstanceAt)` where templateId not null

### 4.3 Events
Extend `swarm_task_events` kinds:
- `recurring.template.created|updated|enabled|disabled`
- `recurring.instance.generated`
- `recurring.instance.skipped` (if we implement skip)

---

## 5) Generation strategy (how instances appear)

We need a generator that creates new instances “just in time” and avoids flooding.

### 5.1 Suggested behavior
- Maintain a rolling window: generate instances up to **X days ahead** (e.g. 14 days) OR up to **N future instances** (e.g. 10), whichever comes first.
- Also generate “due” instances when:
  - Swarm list is loaded (lazy generation), OR
  - a cron runs (recommended), OR
  - an SSE presence/worker process is connected

### 5.2 Recommended generator loop

**Safety guardrails (required):**
- Per-template caps: generate at most **MAX_INSTANCES_PER_TEMPLATE_PER_RUN** (e.g., 50).
- Horizon caps: generate up to **min(HORIZON_DAYS, N_FUTURE_INSTANCES)** (e.g., 14 days or 10 instances).
- Concurrency: acquire a **template-level lock** (Postgres advisory lock keyed by templateId, or `SELECT ... FOR UPDATE` on the template row) before generating instances.
- Idempotency: insert instances using the unique `(recurringTemplateId, recurringInstanceAt)` constraint with `ON CONFLICT DO NOTHING`.

For each enabled template:
1. Determine the next candidate datetime(s) based on the rule.
2. Apply constraints:
   - >= startAt
   - <= endAt (if set)
   - <= count (if set) by checking how many instances already exist
   - match `daysOfWeek` (if set)
   - match `weekParity` (if set)
   - match `betweenHoursStart`/`betweenHoursEnd` (if set), evaluated in `timezone`
3. Insert the instance task if not present (via unique constraint).
4. Update template `nextRunAt`.

### 5.3 Status of generated instances
Default instance status:
- `queued` (or `ready` if you want time-based readiness)

Optional refinement:
- If scheduled time <= now: start in `ready`.

### 5.4 Deduplication & idempotency
- Use `(templateId, recurringInstanceAt)` unique index to ensure the generator is safe under concurrency.

---

## 6) API design (REST)

Namespace: `/api/swarm`

### 6.1 Templates
- `GET /swarm/recurring/templates`
  - filters: project, enabled, owner, q
- `POST /swarm/recurring/templates`
  - body includes:
    - title/detail/projectId
    - startAt/endAt/count
    - everyInterval/everyUnit OR intervalString
    - daysOfWeek/weekParity/timezone
    - primaryAgent/fallbackAgent/ownerUserId/mute

- `GET /swarm/recurring/templates/:id`
- `PATCH /swarm/recurring/templates/:id`
- `POST /swarm/recurring/templates/:id/disable`
- `POST /swarm/recurring/templates/:id/enable`

### 6.2 Generator
- `POST /swarm/recurring/run`
  - admin/agent endpoint that triggers generation (optionally scoped to templateId)

### 6.3 Task list additions
- `GET /swarm/tasks` add filter:
  - `recurringTemplateId=`
  - `isRecurringInstance=true|false`

---

## 7) UI plan (Swarm tab)

### 7.1 New view inside Swarm
Add a secondary sub-tab or toggle within Swarm:
- **Tasks** (existing)
- **Recurring** (templates)

Keep the same visual language: left filters + list + detail drawer.

### 7.2 Recurring templates list
Row shows:
- title
- project accent color
- schedule summary (human-readable)
  - e.g. “Every 2 weeks on Tue/Thu (odd weeks) starting Feb 10”
- enabled/disabled badge
- nextRunAt
- owner + primary/fallback agent
- mute icon if muted

### 7.3 Template detail editor
Editable fields:
- title/detail
- project
- schedule controls:
  - start/end
  - repeat count
  - every interval + unit
  - days of week checkboxes
  - week parity selector (Any / Odd / Even)
  - between hours of (start/end, optional)
  - timezone (default Chicago)
- routing:
  - primary agent / fallback agent
  - owner
  - mute
  - mute interval (optional)

### 7.4 Creating instances visibility
In the normal Tasks timeline:
- Instances appear like normal tasks, but include a small “recurring” icon + link back to the template.

---

## 8) Buzz integration

Emit Buzz events:
- `swarm.recurring.template.created|updated|enabled|disabled`
- `swarm.recurring.instance.generated`

Additionally, when a generated instance changes status, the normal Swarm task Buzz events apply.

**Mute behavior:**
- If `mute=true`, suppress Buzz for instance generation (still allow Buzz for human edits, configurable).
- If `muteInterval` is set, use it as a **throttle window**: at most one automated notification per interval (template failures, instance-generation chatter, etc.).

---

## 9) Failure handling & notifications

### 9.1 Error cases
- Generator fails to compute schedule (bad rule)
- DB insert conflict loops (should be prevented)
- Timezone parsing issues

### 9.2 Owner notifications
When a template has repeated failures:
- notify `ownerUserId` via Buzz (or mailbox if desired)
- include template id + last error + guidance
- respect `mute` / `muteInterval` (throttle automated notifications)

Add fields (optional):
- `lastError` text
- `lastErrorAt` timestamptz
- `errorCount` int
- `lastNotifiedAt` timestamptz (for throttling)

---

## 10) Open questions / decisions
1. Should templates support “business days only” (Mon–Fri) later?
2. For monthly recurrence, do we need “day-of-month” rules (e.g., 15th) vs “nth weekday” rules? (Probably later.)
3. What should `intervalString` support? Recommended: `Xm|Xh|Xd|Xw|Xmo` (avoid ambiguous `m`; use `mo` for month). Reject ambiguous inputs.
4. Should the generator run as:
   - a Hive server cron internally, OR
   - an OpenClaw agent cron hitting `/api/swarm/recurring/run`?

---

## 11) Implementation phases

### Phase 2A — Templates + basic generation
- Add DB tables/fields
- Add CRUD API for templates
- Add generator endpoint and a cron/worker
- Add minimal UI for templates

### Phase 2B — UX polish + safety
- Human-readable schedule summaries
- Robust validation + error reporting
- Owner notifications
- Mute semantics

### Phase 2C — Advanced recurrence (future)
- nth weekday of month, day-of-month, holidays, blackout windows

---

## 12) Acceptance criteria
- Can create a recurring template with all requested criteria.
- Instances auto-appear in Tasks timeline without duplicates.
- Filtering by project/user/status still works for instances.
- Template edits affect future instances only (existing instances remain as historical records).
- Buzz broadcasts happen for template changes and instance generation (unless muted).
- Owner is notified on repeated generator failures.
