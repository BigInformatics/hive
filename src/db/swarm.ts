// Swarm: Task Management Database Module

import { sql } from "./client";

// ============================================================
// Types
// ============================================================

export type TaskStatus = 'queued' | 'ready' | 'in_progress' | 'holding' | 'review' | 'complete';

export interface SwarmProject {
  id: string;
  title: string;
  description: string | null;
  onedevUrl: string | null;
  dokployDeployUrl: string | null;
  color: string;
  projectLeadUserId: string;
  developerLeadUserId: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SwarmTask {
  id: string;
  projectId: string | null;
  title: string;
  detail: string | null;
  issueUrl: string | null;
  creatorUserId: string;
  assigneeUserId: string | null;
  status: TaskStatus;
  onOrAfterAt: Date | null;
  mustBeDoneAfterTaskId: string | null;
  sortKey: number | null;
  nextTaskId: string | null;
  nextTaskAssigneeUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  recurringTemplateId: string | null;
  recurringInstanceAt: Date | null;
  // Computed (not stored)
  blockedReason?: 'dependency' | 'on_or_after' | null;
  project?: SwarmProject | null;
  dependencyTask?: SwarmTask | null;
}

export interface SwarmTaskEvent {
  id: string;
  taskId: string;
  actorUserId: string;
  kind: string;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  createdAt: Date;
}

// ============================================================
// Row Converters
// ============================================================

function rowToProject(row: Record<string, unknown>): SwarmProject {
  return {
    id: row.id as string,
    title: row.title as string,
    description: row.description as string | null,
    onedevUrl: row.onedev_url as string | null,
    dokployDeployUrl: row.dokploy_deploy_url as string | null,
    color: row.color as string,
    projectLeadUserId: row.project_lead_user_id as string,
    developerLeadUserId: row.developer_lead_user_id as string,
    archivedAt: row.archived_at ? new Date(row.archived_at as string) : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function rowToTask(row: Record<string, unknown>): SwarmTask {
  return {
    id: row.id as string,
    projectId: row.project_id as string | null,
    title: row.title as string,
    detail: row.detail as string | null,
    issueUrl: row.issue_url as string | null,
    creatorUserId: row.creator_user_id as string,
    assigneeUserId: row.assignee_user_id as string | null,
    status: row.status as TaskStatus,
    onOrAfterAt: row.on_or_after_at ? new Date(row.on_or_after_at as string) : null,
    mustBeDoneAfterTaskId: row.must_be_done_after_task_id as string | null,
    sortKey: row.sort_key ? Number(row.sort_key) : null,
    nextTaskId: row.next_task_id as string | null,
    nextTaskAssigneeUserId: row.next_task_assignee_user_id as string | null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
    recurringTemplateId: row.recurring_template_id as string | null,
    recurringInstanceAt: row.recurring_instance_at ? new Date(row.recurring_instance_at as string) : null,
  };
}

function rowToEvent(row: Record<string, unknown>): SwarmTaskEvent {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    actorUserId: row.actor_user_id as string,
    kind: row.kind as string,
    beforeState: row.before_state as Record<string, unknown> | null,
    afterState: row.after_state as Record<string, unknown> | null,
    createdAt: new Date(row.created_at as string),
  };
}

// ============================================================
// Projects
// ============================================================

export interface CreateProjectInput {
  title: string;
  description?: string;
  onedevUrl?: string;
  dokployDeployUrl?: string;
  color: string;
  projectLeadUserId: string;
  developerLeadUserId: string;
}

export async function createProject(input: CreateProjectInput): Promise<SwarmProject> {
  const [row] = await sql`
    INSERT INTO public.swarm_projects (
      title, description, onedev_url, dokploy_deploy_url, color,
      project_lead_user_id, developer_lead_user_id
    ) VALUES (
      ${input.title},
      ${input.description || null},
      ${input.onedevUrl || null},
      ${input.dokployDeployUrl || null},
      ${input.color},
      ${input.projectLeadUserId},
      ${input.developerLeadUserId}
    )
    RETURNING *
  `;
  return rowToProject(row);
}

export async function getProject(id: string): Promise<SwarmProject | null> {
  const [row] = await sql`
    SELECT * FROM public.swarm_projects WHERE id = ${id}
  `;
  return row ? rowToProject(row) : null;
}

export interface ListProjectsOptions {
  includeArchived?: boolean;
}

export async function listProjects(opts: ListProjectsOptions = {}): Promise<SwarmProject[]> {
  const rows = opts.includeArchived
    ? await sql`SELECT * FROM public.swarm_projects ORDER BY title`
    : await sql`SELECT * FROM public.swarm_projects WHERE archived_at IS NULL ORDER BY title`;
  return rows.map(rowToProject);
}

export interface UpdateProjectInput {
  title?: string;
  description?: string | null;
  onedevUrl?: string | null;
  dokployDeployUrl?: string | null;
  color?: string;
  projectLeadUserId?: string;
  developerLeadUserId?: string;
}

export async function updateProject(id: string, input: UpdateProjectInput): Promise<SwarmProject | null> {
  const updates: string[] = [];
  const values: unknown[] = [];
  
  if (input.title !== undefined) { updates.push('title'); values.push(input.title); }
  if (input.description !== undefined) { updates.push('description'); values.push(input.description); }
  if (input.onedevUrl !== undefined) { updates.push('onedev_url'); values.push(input.onedevUrl); }
  if (input.dokployDeployUrl !== undefined) { updates.push('dokploy_deploy_url'); values.push(input.dokployDeployUrl); }
  if (input.color !== undefined) { updates.push('color'); values.push(input.color); }
  if (input.projectLeadUserId !== undefined) { updates.push('project_lead_user_id'); values.push(input.projectLeadUserId); }
  if (input.developerLeadUserId !== undefined) { updates.push('developer_lead_user_id'); values.push(input.developerLeadUserId); }
  
  if (updates.length === 0) {
    return getProject(id);
  }
  
  // Build dynamic update - using raw SQL for flexibility
  const setClause = updates.map((col, i) => `${col} = $${i + 2}`).join(', ');
  const query = `
    UPDATE public.swarm_projects 
    SET ${setClause}, updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `;
  
  const [row] = await sql.unsafe(query, [id, ...values]);
  return row ? rowToProject(row) : null;
}

export async function archiveProject(id: string): Promise<SwarmProject | null> {
  const [row] = await sql`
    UPDATE public.swarm_projects 
    SET archived_at = NOW(), updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  return row ? rowToProject(row) : null;
}

export async function unarchiveProject(id: string): Promise<SwarmProject | null> {
  const [row] = await sql`
    UPDATE public.swarm_projects 
    SET archived_at = NULL, updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  return row ? rowToProject(row) : null;
}

// ============================================================
// Tasks
// ============================================================

export interface CreateTaskInput {
  projectId?: string;
  title: string;
  detail?: string;
  issueUrl?: string;
  creatorUserId: string;
  assigneeUserId?: string;
  status?: TaskStatus;
  onOrAfterAt?: Date;
  mustBeDoneAfterTaskId?: string;
  sortKey?: number;
  nextTaskId?: string;
  nextTaskAssigneeUserId?: string;
}

export async function createTask(input: CreateTaskInput): Promise<SwarmTask> {
  const [row] = await sql`
    INSERT INTO public.swarm_tasks (
      project_id, title, detail, issue_url, creator_user_id, assignee_user_id,
      status, on_or_after_at, must_be_done_after_task_id, sort_key,
      next_task_id, next_task_assignee_user_id
    ) VALUES (
      ${input.projectId || null},
      ${input.title},
      ${input.detail || null},
      ${input.issueUrl || null},
      ${input.creatorUserId},
      ${input.assigneeUserId || null},
      ${input.status || 'queued'},
      ${input.onOrAfterAt || null},
      ${input.mustBeDoneAfterTaskId || null},
      ${input.sortKey || null},
      ${input.nextTaskId || null},
      ${input.nextTaskAssigneeUserId || null}
    )
    RETURNING *
  `;
  return rowToTask(row);
}

export async function getTask(id: string): Promise<SwarmTask | null> {
  const [row] = await sql`
    SELECT * FROM public.swarm_tasks WHERE id = ${id}
  `;
  return row ? rowToTask(row) : null;
}

export interface ListTasksOptions {
  statuses?: TaskStatus[];
  assignees?: string[];
  includeUnassigned?: boolean;
  projects?: string[];
  includeNoProject?: boolean;
  creatorUserId?: string;
  query?: string;
  includeFuture?: boolean;
  includeCompleted?: boolean;
  sort?: 'planned' | 'createdAt' | 'updatedAt';
  sortDir?: 'asc' | 'desc';
  limit?: number;
  cursor?: string;
}

export async function listTasks(opts: ListTasksOptions = {}): Promise<SwarmTask[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;
  
  // Status filter
  if (opts.statuses && opts.statuses.length > 0) {
    conditions.push(`status = ANY($${paramIdx}::swarm_task_status[])`);
    params.push(opts.statuses);
    paramIdx++;
  }
  
  // Default: exclude completed unless requested
  if (!opts.includeCompleted && (!opts.statuses || !opts.statuses.includes('complete'))) {
    conditions.push(`status != 'complete'`);
  }
  
  // Assignee filter
  if (opts.assignees && opts.assignees.length > 0) {
    if (opts.includeUnassigned) {
      conditions.push(`(assignee_user_id = ANY($${paramIdx}) OR assignee_user_id IS NULL)`);
    } else {
      conditions.push(`assignee_user_id = ANY($${paramIdx})`);
    }
    params.push(opts.assignees);
    paramIdx++;
  } else if (opts.includeUnassigned) {
    // Only unassigned
    conditions.push(`assignee_user_id IS NULL`);
  }
  
  // Project filter
  if (opts.projects && opts.projects.length > 0) {
    if (opts.includeNoProject) {
      conditions.push(`(project_id = ANY($${paramIdx}::uuid[]) OR project_id IS NULL)`);
    } else {
      conditions.push(`project_id = ANY($${paramIdx}::uuid[])`);
    }
    params.push(opts.projects);
    paramIdx++;
  } else if (opts.includeNoProject) {
    conditions.push(`project_id IS NULL`);
  }
  
  // Creator filter
  if (opts.creatorUserId) {
    conditions.push(`creator_user_id = $${paramIdx}`);
    params.push(opts.creatorUserId);
    paramIdx++;
  }
  
  // Text search
  if (opts.query) {
    conditions.push(`(title ILIKE $${paramIdx} OR detail ILIKE $${paramIdx})`);
    params.push(`%${opts.query}%`);
    paramIdx++;
  }
  
  // Future filter (on_or_after_at > now)
  if (!opts.includeFuture) {
    conditions.push(`(on_or_after_at IS NULL OR on_or_after_at <= NOW())`);
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  // Sorting
  let orderClause: string;
  const sortDir = opts.sortDir || 'asc';
  
  if (opts.sort === 'createdAt') {
    orderClause = `ORDER BY created_at ${sortDir}`;
  } else if (opts.sort === 'updatedAt') {
    orderClause = `ORDER BY updated_at ${sortDir}`;
  } else {
    // Planned ordering (default)
    // 1. Status priority: in_progress, review, ready, queued, holding, complete
    // 2. sort_key ASC (nulls last)
    // 3. on_or_after_at ASC (nulls last)
    // 4. created_at ASC
    orderClause = `
      ORDER BY 
        CASE status
          WHEN 'in_progress' THEN 1
          WHEN 'review' THEN 2
          WHEN 'ready' THEN 3
          WHEN 'queued' THEN 4
          WHEN 'holding' THEN 5
          WHEN 'complete' THEN 6
        END,
        sort_key ASC NULLS LAST,
        on_or_after_at ASC NULLS LAST,
        created_at ASC
    `;
  }
  
  const limit = opts.limit || 100;
  const limitClause = `LIMIT ${limit}`;
  
  const query = `
    SELECT * FROM public.swarm_tasks
    ${whereClause}
    ${orderClause}
    ${limitClause}
  `;
  
  const rows = await sql.unsafe(query, params);
  return rows.map(rowToTask);
}

export interface UpdateTaskInput {
  projectId?: string | null;
  title?: string;
  detail?: string | null;
  issueUrl?: string | null;
  assigneeUserId?: string | null;
  onOrAfterAt?: Date | null;
  mustBeDoneAfterTaskId?: string | null;
  sortKey?: number | null;
  nextTaskId?: string | null;
  nextTaskAssigneeUserId?: string | null;
}

export async function updateTask(id: string, input: UpdateTaskInput): Promise<SwarmTask | null> {
  const updates: string[] = [];
  const values: unknown[] = [];
  
  if (input.projectId !== undefined) { updates.push('project_id'); values.push(input.projectId); }
  if (input.title !== undefined) { updates.push('title'); values.push(input.title); }
  if (input.detail !== undefined) { updates.push('detail'); values.push(input.detail); }
  if (input.issueUrl !== undefined) { updates.push('issue_url'); values.push(input.issueUrl); }
  if (input.assigneeUserId !== undefined) { updates.push('assignee_user_id'); values.push(input.assigneeUserId); }
  if (input.onOrAfterAt !== undefined) { updates.push('on_or_after_at'); values.push(input.onOrAfterAt); }
  if (input.mustBeDoneAfterTaskId !== undefined) { updates.push('must_be_done_after_task_id'); values.push(input.mustBeDoneAfterTaskId); }
  if (input.sortKey !== undefined) { updates.push('sort_key'); values.push(input.sortKey); }
  if (input.nextTaskId !== undefined) { updates.push('next_task_id'); values.push(input.nextTaskId); }
  if (input.nextTaskAssigneeUserId !== undefined) { updates.push('next_task_assignee_user_id'); values.push(input.nextTaskAssigneeUserId); }
  
  if (updates.length === 0) {
    return getTask(id);
  }
  
  const setClause = updates.map((col, i) => `${col} = $${i + 2}`).join(', ');
  const query = `
    UPDATE public.swarm_tasks 
    SET ${setClause}, updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `;
  
  const [row] = await sql.unsafe(query, [id, ...values]);
  return row ? rowToTask(row) : null;
}

// Status transition validation - blocked tasks cannot move to certain states
const BLOCKED_DISALLOWED_TRANSITIONS: TaskStatus[] = ['in_progress', 'review', 'complete'];

export interface StatusTransitionResult {
  success: boolean;
  task?: SwarmTask;
  error?: string;
  blockedReason?: 'dependency' | 'on_or_after';
}

export async function updateTaskStatus(id: string, status: TaskStatus, actorUserId: string): Promise<SwarmTask | null> {
  const result = await updateTaskStatusWithValidation(id, status, actorUserId);
  if (!result.success) {
    throw new Error(result.error || 'Failed to update task status');
  }
  return result.task || null;
}

export async function updateTaskStatusWithValidation(
  id: string, 
  status: TaskStatus, 
  actorUserId: string
): Promise<StatusTransitionResult> {
  // Get current task to record before state and check blocking
  const current = await getTask(id);
  if (!current) {
    return { success: false, error: 'Task not found' };
  }
  
  // Check if task is blocked and the transition is disallowed
  if (BLOCKED_DISALLOWED_TRANSITIONS.includes(status)) {
    const blockedReason = await computeBlockedReason(current);
    if (blockedReason) {
      return { 
        success: false, 
        error: `Cannot transition to ${status}: task is blocked (${blockedReason})`,
        blockedReason 
      };
    }
  }
  
  // Set completedAt if transitioning to complete
  const completedAt = status === 'complete' ? new Date() : null;
  
  const [row] = await sql`
    UPDATE public.swarm_tasks 
    SET status = ${status}::swarm_task_status, 
        completed_at = ${completedAt},
        updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  
  if (row) {
    // Record event
    await createTaskEvent({
      taskId: id,
      actorUserId,
      kind: 'status_changed',
      beforeState: { status: current.status },
      afterState: { status },
    });
  }
  
  return { success: true, task: row ? rowToTask(row) : undefined };
}

export async function claimTask(id: string, userId: string): Promise<SwarmTask | null> {
  const current = await getTask(id);
  if (!current) return null;
  
  const [row] = await sql`
    UPDATE public.swarm_tasks 
    SET assignee_user_id = ${userId}, updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  
  if (row) {
    await createTaskEvent({
      taskId: id,
      actorUserId: userId,
      kind: 'assigned',
      beforeState: { assigneeUserId: current.assigneeUserId },
      afterState: { assigneeUserId: userId },
    });
  }
  
  return row ? rowToTask(row) : null;
}

// ============================================================
// Task Events
// ============================================================

export interface CreateTaskEventInput {
  taskId: string;
  actorUserId: string;
  kind: string;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
}

export async function createTaskEvent(input: CreateTaskEventInput): Promise<SwarmTaskEvent> {
  const [row] = await sql`
    INSERT INTO public.swarm_task_events (
      task_id, actor_user_id, kind, before_state, after_state
    ) VALUES (
      ${input.taskId},
      ${input.actorUserId},
      ${input.kind},
      ${input.beforeState ? JSON.stringify(input.beforeState) : null}::jsonb,
      ${input.afterState ? JSON.stringify(input.afterState) : null}::jsonb
    )
    RETURNING *
  `;
  return rowToEvent(row);
}

export async function getTaskEvents(taskId: string, limit = 50): Promise<SwarmTaskEvent[]> {
  const rows = await sql`
    SELECT * FROM public.swarm_task_events 
    WHERE task_id = ${taskId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map(rowToEvent);
}

// ============================================================
// Computed Fields
// ============================================================

export async function computeBlockedReason(task: SwarmTask): Promise<'dependency' | 'on_or_after' | null> {
  // Check on_or_after constraint
  if (task.onOrAfterAt && task.onOrAfterAt > new Date()) {
    return 'on_or_after';
  }
  
  // Check dependency constraint
  if (task.mustBeDoneAfterTaskId) {
    const depTask = await getTask(task.mustBeDoneAfterTaskId);
    if (depTask && depTask.status !== 'complete') {
      return 'dependency';
    }
  }
  
  return null;
}

export async function enrichTaskWithBlocked(task: SwarmTask): Promise<SwarmTask> {
  task.blockedReason = await computeBlockedReason(task);
  return task;
}

export async function enrichTasksWithBlocked(tasks: SwarmTask[]): Promise<SwarmTask[]> {
  // Batch enrich - get all dependency tasks at once
  const depIds = tasks
    .filter(t => t.mustBeDoneAfterTaskId)
    .map(t => t.mustBeDoneAfterTaskId!);
  
  const depTasks = depIds.length > 0 
    ? await sql.unsafe(`SELECT id, status FROM public.swarm_tasks WHERE id = ANY($1::uuid[])`, [depIds])
    : [];
  
  const depStatusMap = new Map(depTasks.map(r => [r.id as string, r.status as TaskStatus]));
  const now = new Date();
  
  return tasks.map(task => {
    if (task.onOrAfterAt && task.onOrAfterAt > now) {
      task.blockedReason = 'on_or_after';
    } else if (task.mustBeDoneAfterTaskId) {
      const depStatus = depStatusMap.get(task.mustBeDoneAfterTaskId);
      if (depStatus && depStatus !== 'complete') {
        task.blockedReason = 'dependency';
      }
    }
    return task;
  });
}

// ============================================================
// Reorder
// ============================================================

const SORT_KEY_GAP = 65536; // Gap between sort keys for easy insertion

/**
 * Reorder a task to appear before another task.
 * Server computes the sortKey - clients should not write raw sortKeys.
 */
export async function reorderTask(
  taskId: string, 
  beforeTaskId: string | null, 
  actorUserId: string
): Promise<SwarmTask | null> {
  const task = await getTask(taskId);
  if (!task) return null;
  
  const oldSortKey = task.sortKey;
  let newSortKey: number;
  
  if (beforeTaskId === null) {
    // Move to the end - find the max sortKey and add gap
    const [maxRow] = await sql`
      SELECT MAX(sort_key) as max_key FROM public.swarm_tasks 
      WHERE status = ${task.status}::swarm_task_status
    `;
    const maxKey = maxRow?.max_key ? Number(maxRow.max_key) : 0;
    newSortKey = maxKey + SORT_KEY_GAP;
  } else {
    // Get the beforeTask and the task before it
    const beforeTask = await getTask(beforeTaskId);
    if (!beforeTask) {
      throw new Error('beforeTaskId not found');
    }
    
    // Find the task that's currently before beforeTask (by sortKey in same status bucket)
    const [prevRow] = await sql`
      SELECT sort_key FROM public.swarm_tasks 
      WHERE status = ${beforeTask.status}::swarm_task_status
        AND sort_key < ${beforeTask.sortKey || 0}
        AND id != ${taskId}
      ORDER BY sort_key DESC
      LIMIT 1
    `;
    
    const beforeSortKey = beforeTask.sortKey || SORT_KEY_GAP;
    const prevSortKey = prevRow?.sort_key ? Number(prevRow.sort_key) : 0;
    
    // Place our task between prevSortKey and beforeSortKey
    newSortKey = Math.floor((prevSortKey + beforeSortKey) / 2);
    
    // If no room, rebalance the sort keys (rare case)
    if (newSortKey === prevSortKey || newSortKey === beforeSortKey) {
      await rebalanceSortKeys(task.status);
      // Retry after rebalancing
      return reorderTask(taskId, beforeTaskId, actorUserId);
    }
  }
  
  // Update the task's sortKey
  const [row] = await sql`
    UPDATE public.swarm_tasks 
    SET sort_key = ${newSortKey}, updated_at = NOW()
    WHERE id = ${taskId}
    RETURNING *
  `;
  
  if (row) {
    await createTaskEvent({
      taskId,
      actorUserId,
      kind: 'reordered',
      beforeState: { sortKey: oldSortKey },
      afterState: { sortKey: newSortKey },
    });
  }
  
  return row ? rowToTask(row) : null;
}

/**
 * Rebalance sort keys for a given status bucket.
 * Called when there's no room between two adjacent sort keys.
 */
async function rebalanceSortKeys(status: TaskStatus): Promise<void> {
  const tasks = await sql`
    SELECT id FROM public.swarm_tasks 
    WHERE status = ${status}::swarm_task_status
    ORDER BY sort_key ASC NULLS LAST, created_at ASC
  `;
  
  for (let i = 0; i < tasks.length; i++) {
    await sql`
      UPDATE public.swarm_tasks 
      SET sort_key = ${(i + 1) * SORT_KEY_GAP}
      WHERE id = ${tasks[i].id}
    `;
  }
  
  console.log(`[swarm] Rebalanced ${tasks.length} tasks in status ${status}`);
}

// ============================================================
// Recurring Templates
// ============================================================

export type EveryUnit = 'minute' | 'hour' | 'day' | 'week' | 'month';
export type WeekParity = 'any' | 'odd' | 'even';

export interface RecurringTemplate {
  id: string;
  projectId: string | null;
  title: string;
  detail: string | null;
  primaryAgent: string | null;
  fallbackAgent: string | null;
  ownerUserId: string;
  mute: boolean;
  muteInterval: string | null;
  timezone: string;
  startAt: Date;
  endAt: Date | null;
  repeatCount: number | null;
  everyInterval: number;
  everyUnit: EveryUnit;
  daysOfWeek: string[] | null;
  weekParity: WeekParity;
  betweenHoursStart: number | null;
  betweenHoursEnd: number | null;
  enabled: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function rowToTemplate(row: Record<string, unknown>): RecurringTemplate {
  // Postgres returns Date objects directly, not strings
  const toDate = (val: unknown): Date => {
    if (val instanceof Date) return val;
    if (typeof val === 'string') return new Date(val);
    return new Date(String(val));
  };
  
  return {
    id: row.id as string,
    projectId: row.project_id as string | null,
    title: row.title as string,
    detail: row.detail as string | null,
    primaryAgent: row.primary_agent as string | null,
    fallbackAgent: row.fallback_agent as string | null,
    ownerUserId: row.owner_user_id as string,
    mute: row.mute as boolean,
    muteInterval: row.mute_interval as string | null,
    timezone: row.timezone as string,
    startAt: toDate(row.start_at),
    endAt: row.end_at ? toDate(row.end_at) : null,
    repeatCount: row.repeat_count as number | null,
    everyInterval: row.every_interval as number,
    everyUnit: row.every_unit as EveryUnit,
    daysOfWeek: row.days_of_week as string[] | null,
    weekParity: row.week_parity as WeekParity,
    betweenHoursStart: row.between_hours_start as number | null,
    betweenHoursEnd: row.between_hours_end as number | null,
    enabled: row.enabled as boolean,
    lastRunAt: row.last_run_at ? toDate(row.last_run_at) : null,
    nextRunAt: row.next_run_at ? toDate(row.next_run_at) : null,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

export interface CreateTemplateInput {
  projectId?: string;
  title: string;
  detail?: string;
  primaryAgent?: string;
  fallbackAgent?: string;
  ownerUserId: string;
  mute?: boolean;
  muteInterval?: string;
  timezone?: string;
  startAt: Date;
  endAt?: Date;
  repeatCount?: number;
  everyInterval: number;
  everyUnit: EveryUnit;
  daysOfWeek?: string[];
  weekParity?: WeekParity;
  betweenHoursStart?: number;
  betweenHoursEnd?: number;
}

export async function createTemplate(input: CreateTemplateInput): Promise<RecurringTemplate> {
  const [row] = await sql`
    INSERT INTO public.swarm_recurring_templates (
      project_id, title, detail, primary_agent, fallback_agent, owner_user_id,
      mute, mute_interval, timezone, start_at, end_at, repeat_count,
      every_interval, every_unit, days_of_week, week_parity,
      between_hours_start, between_hours_end
    ) VALUES (
      ${input.projectId || null},
      ${input.title},
      ${input.detail || null},
      ${input.primaryAgent || null},
      ${input.fallbackAgent || null},
      ${input.ownerUserId},
      ${input.mute || false},
      ${input.muteInterval || null},
      ${input.timezone || 'America/Chicago'},
      ${input.startAt},
      ${input.endAt || null},
      ${input.repeatCount || null},
      ${input.everyInterval},
      ${input.everyUnit},
      ${input.daysOfWeek || null},
      ${input.weekParity || 'any'},
      ${input.betweenHoursStart ?? null},
      ${input.betweenHoursEnd ?? null}
    )
    RETURNING *
  `;
  return rowToTemplate(row);
}

export async function getTemplate(id: string): Promise<RecurringTemplate | null> {
  const [row] = await sql`
    SELECT * FROM public.swarm_recurring_templates WHERE id = ${id}
  `;
  return row ? rowToTemplate(row) : null;
}

export interface ListTemplatesOptions {
  projectId?: string;
  enabled?: boolean;
  ownerUserId?: string;
}

export async function listTemplates(opts: ListTemplatesOptions = {}): Promise<RecurringTemplate[]> {
  // Simple version - fetch all then filter in JS for now
  console.log("[swarm] listTemplates called with opts:", opts);
  const rows = await sql`
    SELECT * FROM public.swarm_recurring_templates
    ORDER BY created_at DESC
  `;
  console.log("[swarm] listTemplates query returned", rows.length, "rows");
  
  let result = rows.map(row => {
    try {
      return rowToTemplate(row);
    } catch (err) {
      console.error("[swarm] rowToTemplate error:", err, "row:", row);
      throw err;
    }
  });
  
  if (opts.projectId !== undefined) {
    result = result.filter(t => t.projectId === opts.projectId);
  }
  if (opts.enabled !== undefined) {
    result = result.filter(t => t.enabled === opts.enabled);
  }
  if (opts.ownerUserId !== undefined) {
    result = result.filter(t => t.ownerUserId === opts.ownerUserId);
  }
  
  return result;
}

export interface UpdateTemplateInput {
  projectId?: string | null;
  title?: string;
  detail?: string | null;
  primaryAgent?: string | null;
  fallbackAgent?: string | null;
  ownerUserId?: string;
  mute?: boolean;
  muteInterval?: string | null;
  timezone?: string;
  startAt?: Date;
  endAt?: Date | null;
  repeatCount?: number | null;
  everyInterval?: number;
  everyUnit?: EveryUnit;
  daysOfWeek?: string[] | null;
  weekParity?: WeekParity;
  betweenHoursStart?: number | null;
  betweenHoursEnd?: number | null;
  enabled?: boolean;
  lastRunAt?: Date | null;
  nextRunAt?: Date | null;
}

export async function updateTemplate(id: string, input: UpdateTemplateInput): Promise<RecurringTemplate | null> {
  const updates: string[] = [];
  const values: unknown[] = [];
  
  if (input.projectId !== undefined) { updates.push('project_id'); values.push(input.projectId); }
  if (input.title !== undefined) { updates.push('title'); values.push(input.title); }
  if (input.detail !== undefined) { updates.push('detail'); values.push(input.detail); }
  if (input.primaryAgent !== undefined) { updates.push('primary_agent'); values.push(input.primaryAgent); }
  if (input.fallbackAgent !== undefined) { updates.push('fallback_agent'); values.push(input.fallbackAgent); }
  if (input.ownerUserId !== undefined) { updates.push('owner_user_id'); values.push(input.ownerUserId); }
  if (input.mute !== undefined) { updates.push('mute'); values.push(input.mute); }
  if (input.muteInterval !== undefined) { updates.push('mute_interval'); values.push(input.muteInterval); }
  if (input.timezone !== undefined) { updates.push('timezone'); values.push(input.timezone); }
  if (input.startAt !== undefined) { updates.push('start_at'); values.push(input.startAt); }
  if (input.endAt !== undefined) { updates.push('end_at'); values.push(input.endAt); }
  if (input.repeatCount !== undefined) { updates.push('repeat_count'); values.push(input.repeatCount); }
  if (input.everyInterval !== undefined) { updates.push('every_interval'); values.push(input.everyInterval); }
  if (input.everyUnit !== undefined) { updates.push('every_unit'); values.push(input.everyUnit); }
  if (input.daysOfWeek !== undefined) { updates.push('days_of_week'); values.push(input.daysOfWeek); }
  if (input.weekParity !== undefined) { updates.push('week_parity'); values.push(input.weekParity); }
  if (input.betweenHoursStart !== undefined) { updates.push('between_hours_start'); values.push(input.betweenHoursStart); }
  if (input.betweenHoursEnd !== undefined) { updates.push('between_hours_end'); values.push(input.betweenHoursEnd); }
  if (input.enabled !== undefined) { updates.push('enabled'); values.push(input.enabled); }
  if (input.lastRunAt !== undefined) { updates.push('last_run_at'); values.push(input.lastRunAt); }
  if (input.nextRunAt !== undefined) { updates.push('next_run_at'); values.push(input.nextRunAt); }
  
  if (updates.length === 0) {
    return getTemplate(id);
  }
  
  const setClause = updates.map((col, i) => `${col} = $${i + 2}`).join(', ');
  const query = `
    UPDATE public.swarm_recurring_templates 
    SET ${setClause}, updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `;
  
  const [row] = await sql.unsafe(query, [id, ...values]);
  return row ? rowToTemplate(row) : null;
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM public.swarm_recurring_templates WHERE id = ${id}
  `;
  return result.count > 0;
}

export async function enableTemplate(id: string): Promise<RecurringTemplate | null> {
  return updateTemplate(id, { enabled: true });
}

export async function disableTemplate(id: string): Promise<RecurringTemplate | null> {
  return updateTemplate(id, { enabled: false, nextRunAt: null });
}
