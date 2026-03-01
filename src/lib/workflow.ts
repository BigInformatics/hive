import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  type SwarmTaskWorkflow,
  swarmTaskWorkflows,
  type Workflow,
  workflows,
} from "@/db/schema";

// ============================================================
// WORKFLOWS
// ============================================================

export async function listWorkflows(opts: {
  identity?: string;
  includeDisabled?: boolean;
}): Promise<Workflow[]> {
  const conditions = [];

  if (!opts.includeDisabled) {
    conditions.push(eq(workflows.enabled, true));
  }

  // Visibility: null/[] → open; non-empty → only tagged identities
  if (opts.identity) {
    conditions.push(
      sql`(
        ${workflows.taggedUsers} IS NULL
        OR ${workflows.taggedUsers} = '[]'::jsonb
        OR ${workflows.taggedUsers} @> ${sql`${JSON.stringify([opts.identity])}::jsonb`}
      )`,
    );
  }

  return db
    .select()
    .from(workflows)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(workflows.title));
}

export async function getWorkflow(
  id: string,
  identity?: string,
): Promise<Workflow | null> {
  const rows = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, id))
    .limit(1);

  if (!rows[0]) return null;
  const wf = rows[0];

  // Check visibility
  if (identity && wf.taggedUsers && (wf.taggedUsers as string[]).length > 0) {
    if (!(wf.taggedUsers as string[]).includes(identity)) return null;
  }

  return wf;
}

export async function createWorkflow(input: {
  title: string;
  description?: string;
  documentUrl?: string;
  document?: unknown;
  enabled?: boolean;
  taggedUsers?: string[];
  expiresAt?: Date;
  reviewAt?: Date;
  createdBy: string;
}): Promise<Workflow> {
  const [row] = await db
    .insert(workflows)
    .values({
      title: input.title,
      description: input.description ?? null,
      documentUrl: input.documentUrl ?? null,
      document: input.document ?? null,
      enabled: input.enabled ?? true,
      taggedUsers: input.taggedUsers ?? null,
      expiresAt: input.expiresAt ?? null,
      reviewAt: input.reviewAt ?? null,
      createdBy: input.createdBy,
    })
    .returning();
  return row;
}

export async function updateWorkflow(
  id: string,
  patch: Partial<{
    title: string;
    description: string | null;
    documentUrl: string | null;
    document: unknown;
    enabled: boolean;
    taggedUsers: string[] | null;
    expiresAt: Date | null;
    reviewAt: Date | null;
  }>,
): Promise<Workflow | null> {
  const rows = await db
    .update(workflows)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(workflows.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function deleteWorkflow(id: string): Promise<boolean> {
  const result = await db
    .delete(workflows)
    .where(eq(workflows.id, id))
    .returning({ id: workflows.id });
  return result.length > 0;
}

// ============================================================
// TASK ↔ WORKFLOW ATTACHMENTS
// ============================================================

export async function listTaskWorkflows(
  taskId: string,
  identity?: string,
): Promise<Workflow[]> {
  const rows = await db
    .select({ workflow: workflows })
    .from(swarmTaskWorkflows)
    .innerJoin(workflows, eq(swarmTaskWorkflows.workflowId, workflows.id))
    .where(eq(swarmTaskWorkflows.taskId, taskId))
    .orderBy(asc(workflows.title));

  return rows
    .map((r) => r.workflow)
    .filter((wf) => {
      if (!identity) return true;
      if (!wf.taggedUsers || (wf.taggedUsers as string[]).length === 0)
        return true;
      return (wf.taggedUsers as string[]).includes(identity);
    });
}

export async function attachWorkflow(input: {
  taskId: string;
  workflowId: string;
  attachedBy: string;
}): Promise<SwarmTaskWorkflow> {
  const [row] = await db
    .insert(swarmTaskWorkflows)
    .values(input)
    .onConflictDoNothing()
    .returning();
  // If already attached, return the existing row
  if (!row) {
    const existing = await db
      .select()
      .from(swarmTaskWorkflows)
      .where(
        and(
          eq(swarmTaskWorkflows.taskId, input.taskId),
          eq(swarmTaskWorkflows.workflowId, input.workflowId),
        ),
      )
      .limit(1);
    return existing[0];
  }
  return row;
}

export async function detachWorkflow(
  taskId: string,
  workflowId: string,
): Promise<boolean> {
  const result = await db
    .delete(swarmTaskWorkflows)
    .where(
      and(
        eq(swarmTaskWorkflows.taskId, taskId),
        eq(swarmTaskWorkflows.workflowId, workflowId),
      ),
    )
    .returning();
  return result.length > 0;
}
