import { and, asc, desc, eq, isNull, inArray, sql as rawSql, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  swarmProjects,
  swarmTasks,
  swarmTaskEvents,
  type SwarmProject,
  type SwarmTask,
  type SwarmTaskEvent,
} from "@/db/schema";

export type TaskStatus =
  | "queued"
  | "ready"
  | "in_progress"
  | "holding"
  | "review"
  | "complete";

// ============================================================
// PROJECTS
// ============================================================

export async function createProject(input: {
  title: string;
  description?: string;
  color: string;
  projectLeadUserId: string;
  developerLeadUserId: string;
  websiteUrl?: string;
  onedevUrl?: string;
  githubUrl?: string;
  dokployDeployUrl?: string;
  workHoursStart?: string;
  workHoursEnd?: string;
  workHoursTimezone?: string;
  blockingMode?: boolean;
}): Promise<SwarmProject> {
  const [row] = await db
    .insert(swarmProjects)
    .values({
      title: input.title,
      description: input.description || null,
      color: input.color,
      projectLeadUserId: input.projectLeadUserId,
      developerLeadUserId: input.developerLeadUserId,
      websiteUrl: input.websiteUrl || null,
      onedevUrl: input.onedevUrl || null,
      githubUrl: input.githubUrl || null,
      dokployDeployUrl: input.dokployDeployUrl || null,
      workHoursStart: input.workHoursStart || null,
      workHoursEnd: input.workHoursEnd || null,
      workHoursTimezone: input.workHoursTimezone || "America/Chicago",
      blockingMode: input.blockingMode || false,
    })
    .returning();
  return row;
}

export async function listProjects(
  includeArchived = false,
): Promise<SwarmProject[]> {
  if (includeArchived) {
    return db.select().from(swarmProjects).orderBy(asc(swarmProjects.title));
  }
  return db
    .select()
    .from(swarmProjects)
    .where(isNull(swarmProjects.archivedAt))
    .orderBy(asc(swarmProjects.title));
}

export async function getProject(id: string): Promise<SwarmProject | null> {
  const [row] = await db
    .select()
    .from(swarmProjects)
    .where(eq(swarmProjects.id, id));
  return row || null;
}

export async function updateProject(
  id: string,
  input: Partial<{
    title: string;
    description: string | null;
    color: string;
    projectLeadUserId: string;
    developerLeadUserId: string;
    websiteUrl: string | null;
    onedevUrl: string | null;
    githubUrl: string | null;
    dokployDeployUrl: string | null;
    workHoursStart: string | null;
    workHoursEnd: string | null;
    workHoursTimezone: string;
    blockingMode: boolean;
  }>,
): Promise<SwarmProject | null> {
  const [row] = await db
    .update(swarmProjects)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(swarmProjects.id, id))
    .returning();
  return row || null;
}

export async function archiveProject(id: string): Promise<SwarmProject | null> {
  const [row] = await db
    .update(swarmProjects)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(swarmProjects.id, id))
    .returning();
  return row || null;
}

// ============================================================
// TASKS
// ============================================================

export async function createTask(input: {
  projectId?: string;
  title: string;
  detail?: string;
  issueUrl?: string;
  creatorUserId: string;
  assigneeUserId?: string;
  status?: TaskStatus;
  onOrAfterAt?: Date;
  mustBeDoneAfterTaskId?: string;
  nextTaskId?: string;
  nextTaskAssigneeUserId?: string;
  recurringTemplateId?: string;
  recurringInstanceAt?: Date;
}): Promise<SwarmTask> {
  const [row] = await db
    .insert(swarmTasks)
    .values({
      projectId: input.projectId || null,
      title: input.title,
      detail: input.detail || null,
      issueUrl: input.issueUrl || null,
      creatorUserId: input.creatorUserId,
      assigneeUserId: input.assigneeUserId || null,
      status: input.status || "queued",
      onOrAfterAt: input.onOrAfterAt || null,
      mustBeDoneAfterTaskId: input.mustBeDoneAfterTaskId || null,
      nextTaskId: input.nextTaskId || null,
      nextTaskAssigneeUserId: input.nextTaskAssigneeUserId || null,
      recurringTemplateId: input.recurringTemplateId || null,
      recurringInstanceAt: input.recurringInstanceAt || null,
    })
    .returning();

  // Record creation event
  await createTaskEvent({
    taskId: row.id,
    actorUserId: input.creatorUserId,
    kind: "created",
    afterState: { title: row.title, status: row.status },
  });

  return row;
}

export async function getTask(id: string): Promise<SwarmTask | null> {
  const [row] = await db
    .select()
    .from(swarmTasks)
    .where(eq(swarmTasks.id, id));
  return row || null;
}

export async function listTasks(opts?: {
  statuses?: TaskStatus[];
  assignee?: string;
  projectId?: string;
  includeCompleted?: boolean;
}): Promise<SwarmTask[]> {
  const conditions = [];

  if (opts?.statuses && opts.statuses.length > 0) {
    conditions.push(inArray(swarmTasks.status, opts.statuses));
  } else if (!opts?.includeCompleted) {
    conditions.push(ne(swarmTasks.status, "complete"));
  }

  if (opts?.assignee) {
    conditions.push(eq(swarmTasks.assigneeUserId, opts.assignee));
  }

  if (opts?.projectId) {
    conditions.push(eq(swarmTasks.projectId, opts.projectId));
  }

  return db
    .select()
    .from(swarmTasks)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(
      rawSql`CASE status
        WHEN 'in_progress' THEN 1
        WHEN 'review' THEN 2
        WHEN 'ready' THEN 3
        WHEN 'queued' THEN 4
        WHEN 'holding' THEN 5
        WHEN 'complete' THEN 6
      END`,
      asc(swarmTasks.sortKey),
      asc(swarmTasks.createdAt),
    );
}

export async function updateTask(
  id: string,
  input: Partial<{
    projectId: string | null;
    title: string;
    detail: string | null;
    issueUrl: string | null;
    assigneeUserId: string | null;
    onOrAfterAt: Date | null;
    mustBeDoneAfterTaskId: string | null;
    sortKey: number;
    nextTaskId: string | null;
    nextTaskAssigneeUserId: string | null;
  }>,
): Promise<SwarmTask | null> {
  const [row] = await db
    .update(swarmTasks)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(swarmTasks.id, id))
    .returning();
  return row || null;
}

export async function updateTaskStatus(
  id: string,
  status: TaskStatus,
  actorUserId: string,
): Promise<SwarmTask | null> {
  const current = await getTask(id);
  if (!current) return null;

  const completedAt = status === "complete" ? new Date() : null;

  const [row] = await db
    .update(swarmTasks)
    .set({ status, completedAt, updatedAt: new Date() })
    .where(eq(swarmTasks.id, id))
    .returning();

  if (row) {
    await createTaskEvent({
      taskId: id,
      actorUserId,
      kind: "status_changed",
      beforeState: { status: current.status },
      afterState: { status },
    });
  }

  return row || null;
}

export async function assignTask(
  id: string,
  assigneeUserId: string | null,
  actorUserId: string,
): Promise<SwarmTask | null> {
  const current = await getTask(id);
  if (!current) return null;

  const [row] = await db
    .update(swarmTasks)
    .set({ assigneeUserId, updatedAt: new Date() })
    .where(eq(swarmTasks.id, id))
    .returning();

  if (row) {
    await createTaskEvent({
      taskId: id,
      actorUserId,
      kind: "assigned",
      beforeState: { assigneeUserId: current.assigneeUserId },
      afterState: { assigneeUserId },
    });
  }

  return row || null;
}

// ============================================================
// TASK EVENTS
// ============================================================

export async function createTaskEvent(input: {
  taskId: string;
  actorUserId: string;
  kind: string;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
}): Promise<SwarmTaskEvent> {
  const [row] = await db
    .insert(swarmTaskEvents)
    .values({
      taskId: input.taskId,
      actorUserId: input.actorUserId,
      kind: input.kind,
      beforeState: input.beforeState || null,
      afterState: input.afterState || null,
    })
    .returning();
  return row;
}

export async function getTaskEvents(
  taskId: string,
  limit = 50,
): Promise<SwarmTaskEvent[]> {
  return db
    .select()
    .from(swarmTaskEvents)
    .where(eq(swarmTaskEvents.taskId, taskId))
    .orderBy(desc(swarmTaskEvents.createdAt))
    .limit(limit);
}
