import { eq } from "drizzle-orm";
import { defineEventHandler, getRouterParam, readBody } from "h3";
import { db } from "@/db";
import { mailboxTokens, users } from "@/db/schema";
import {
  authenticateEvent,
  clearAuthCache,
  deregisterMailbox,
  registerMailbox,
} from "@/lib/auth";

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

  if ("displayName" in body && body.displayName !== undefined)
    patch.displayName = String(body.displayName);
  if ("isAdmin" in body && body.isAdmin !== undefined) {
    if (typeof body.isAdmin !== "boolean")
      return new Response(
        JSON.stringify({ error: "isAdmin must be a boolean" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    patch.isAdmin = body.isAdmin;
  }
  if ("isAgent" in body && body.isAgent !== undefined) {
    if (typeof body.isAgent !== "boolean")
      return new Response(
        JSON.stringify({ error: "isAgent must be a boolean" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    patch.isAgent = body.isAgent;
  }
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

  // Clear auth cache when admin status changes (isAdmin is now read from users table on each auth)
  if ("isAdmin" in patch) {
    clearAuthCache();
  }

  // Sync in-memory mailbox set and token validity immediately
  if ("archivedAt" in patch) {
    if (patch.archivedAt) {
      // Archive: remove from valid mailboxes and revoke all DB tokens
      deregisterMailbox(id);
      await db
        .update(mailboxTokens)
        .set({ revokedAt: new Date() })
        .where(eq(mailboxTokens.identity, id));
      clearAuthCache();
    } else {
      // Restore: re-add to valid mailboxes; revoked tokens remain revoked
      // (admin must issue new tokens via invite or token endpoint)
      registerMailbox(id);
      clearAuthCache();
    }
  }

  return { user: updated };
});
