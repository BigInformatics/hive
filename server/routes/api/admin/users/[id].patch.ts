import { defineEventHandler, readBody, getRouterParam } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

interface UserPatchBody {
  displayName?: string;
  isAdmin?: boolean;
  isAgent?: boolean;
  avatarUrl?: string | null;
  archivedAt?: string | null;
}

/**
 * PATCH /api/admin/users/:id
 * Update a user's profile. Admin only.
 */
export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!auth.isAdmin) {
    return new Response(JSON.stringify({ error: "Admin required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const id = getRouterParam(event, "id");
  if (!id) {
    return new Response(JSON.stringify({ error: "User ID required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const raw = await readBody<Record<string, unknown>>(event);
  const body: UserPatchBody = raw ?? {};

  const patch: Partial<typeof users.$inferInsert> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };

  if ("displayName" in body && body.displayName !== undefined) patch.displayName = String(body.displayName);
  if ("isAdmin" in body && body.isAdmin !== undefined) patch.isAdmin = Boolean(body.isAdmin);
  if ("isAgent" in body && body.isAgent !== undefined) patch.isAgent = Boolean(body.isAgent);
  if ("avatarUrl" in body) patch.avatarUrl = body.avatarUrl ?? null;
  if ("archivedAt" in body) {
    patch.archivedAt = body.archivedAt ? new Date(body.archivedAt) : null;
  }

  const [updated] = await db
    .update(users)
    .set(patch)
    .where(eq(users.id, id))
    .returning();

  if (!updated) {
    return new Response(JSON.stringify({ error: "User not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return { user: updated };
});
