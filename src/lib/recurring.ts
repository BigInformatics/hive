import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { type RecurringTemplate, recurringTemplates } from "@/db/schema";
import { createTask, type TaskStatus } from "./swarm";

// Minimal cron parser — supports standard 5-field cron (min hour dom month dow)
function parseCron(expr: string): {
  minute: number[];
  hour: number[];
  dom: number[];
  month: number[];
  dow: number[];
} {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron: ${expr}`);

  const parseField = (field: string, min: number, max: number): number[] => {
    const values: number[] = [];
    for (const part of field.split(",")) {
      if (part === "*") {
        for (let i = min; i <= max; i++) values.push(i);
      } else if (part.includes("/")) {
        const [range, stepStr] = part.split("/");
        const step = Number.parseInt(stepStr, 10);
        const start = range === "*" ? min : Number.parseInt(range, 10);
        for (let i = start; i <= max; i += step) values.push(i);
      } else if (part.includes("-")) {
        const [a, b] = part.split("-").map((n) => Number.parseInt(n, 10));
        for (let i = a; i <= b; i++) values.push(i);
      } else {
        values.push(Number.parseInt(part, 10));
      }
    }
    return values;
  };

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dom: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dow: parseField(parts[4], 0, 6),
  };
}

/** Compute the next run time after `after` for a given cron expression */
export function getNextRun(cronExpr: string, after: Date = new Date()): Date {
  const cron = parseCron(cronExpr);
  const d = new Date(after);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1); // Start from the next minute

  // Brute force search (max 1 year ahead)
  const limit = 366 * 24 * 60;
  for (let i = 0; i < limit; i++) {
    if (
      cron.month.includes(d.getMonth() + 1) &&
      cron.dom.includes(d.getDate()) &&
      cron.dow.includes(d.getDay()) &&
      cron.hour.includes(d.getHours()) &&
      cron.minute.includes(d.getMinutes())
    ) {
      return d;
    }
    d.setMinutes(d.getMinutes() + 1);
  }

  // Fallback: 1 day from now
  return new Date(after.getTime() + 86400000);
}

// ============================================================
// CRUD
// ============================================================

export async function createRecurringTemplate(input: {
  projectId?: string;
  title: string;
  detail?: string;
  assigneeUserId?: string;
  creatorUserId: string;
  cronExpr: string;
  timezone?: string;
  initialStatus?: TaskStatus;
}): Promise<RecurringTemplate> {
  const nextRunAt = getNextRun(input.cronExpr);

  const [row] = await db
    .insert(recurringTemplates)
    .values({
      projectId: input.projectId || null,
      title: input.title,
      detail: input.detail || null,
      assigneeUserId: input.assigneeUserId || null,
      creatorUserId: input.creatorUserId,
      cronExpr: input.cronExpr,
      timezone: input.timezone || "America/Chicago",
      initialStatus: input.initialStatus || "ready",
      nextRunAt,
    })
    .returning();

  return row;
}

export async function listRecurringTemplates(
  includeDisabled = false,
): Promise<RecurringTemplate[]> {
  const conditions = includeDisabled
    ? []
    : [eq(recurringTemplates.enabled, true)];

  return db
    .select()
    .from(recurringTemplates)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(recurringTemplates.title));
}

export async function getRecurringTemplate(
  id: string,
): Promise<RecurringTemplate | null> {
  const [row] = await db
    .select()
    .from(recurringTemplates)
    .where(eq(recurringTemplates.id, id));
  return row || null;
}

export async function updateRecurringTemplate(
  id: string,
  input: Partial<{
    projectId: string | null;
    title: string;
    detail: string | null;
    assigneeUserId: string | null;
    cronExpr: string;
    timezone: string;
    initialStatus: string;
    enabled: boolean;
  }>,
): Promise<RecurringTemplate | null> {
  const updates: Record<string, unknown> = { ...input, updatedAt: new Date() };

  // Recalculate next run if cron changed
  if (input.cronExpr) {
    updates.nextRunAt = getNextRun(input.cronExpr);
  }

  const [row] = await db
    .update(recurringTemplates)
    .set(updates)
    .where(eq(recurringTemplates.id, id))
    .returning();

  return row || null;
}

export async function deleteRecurringTemplate(id: string): Promise<boolean> {
  const result = await db
    .delete(recurringTemplates)
    .where(eq(recurringTemplates.id, id))
    .returning();
  return result.length > 0;
}

// ============================================================
// TICK — called periodically to create tasks from due templates
// ============================================================

export async function tickRecurring(): Promise<{
  created: number;
  errors: number;
}> {
  const now = new Date();
  let created = 0;
  let errors = 0;

  // Find all enabled templates that are due
  const due = await db
    .select()
    .from(recurringTemplates)
    .where(
      and(
        eq(recurringTemplates.enabled, true),
        or(
          lte(recurringTemplates.nextRunAt, now),
          isNull(recurringTemplates.nextRunAt),
        ),
      ),
    );

  for (const template of due) {
    try {
      // Create the task
      await createTask({
        projectId: template.projectId || undefined,
        title: template.title,
        detail: template.detail || undefined,
        creatorUserId: template.creatorUserId,
        assigneeUserId: template.assigneeUserId || undefined,
        status: (template.initialStatus as TaskStatus) || "ready",
      });

      // Update last/next run
      const nextRunAt = getNextRun(template.cronExpr, now);
      await db
        .update(recurringTemplates)
        .set({ lastRunAt: now, nextRunAt, updatedAt: now })
        .where(eq(recurringTemplates.id, template.id));

      created++;
    } catch (err) {
      console.error(
        `[recurring] Failed to create task from template ${template.id}:`,
        err,
      );
      errors++;
    }
  }

  return { created, errors };
}
