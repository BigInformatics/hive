import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { H3Event } from "h3";
import { getHeader } from "h3";
import { db } from "@/db";
import { mailboxTokens, users } from "@/db/schema";

export interface AuthContext {
  identity: string;
  isAdmin: boolean;
  source: "db" | "env";
}

// In-memory env token cache (loaded once at startup — superuser only)
const envTokens = new Map<string, AuthContext>();
const validMailboxes = new Set<string>();

// DB token cache (short TTL to avoid constant queries)
const dbCache = new Map<string, { ctx: AuthContext | null; expires: number }>();
const DB_CACHE_TTL = 30_000; // 30 seconds

/** Load all active users from DB into validMailboxes at startup */
async function loadUsersFromDb() {
  try {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(isNull(users.archivedAt));
    for (const row of rows) {
      validMailboxes.add(row.id);
    }
    console.log(
      `[auth] Loaded ${rows.length} user(s) from DB into validMailboxes`,
    );
  } catch (err) {
    console.error("[auth] Failed to load users from DB:", err);
  }
}

/**
 * Backfill missing users rows from active mailbox tokens.
 * Important for upgrades: tokens may exist from before the users table was introduced.
 */
async function backfillUsersFromTokens() {
  try {
    const tokenIdentities = await db
      .selectDistinct({ identity: mailboxTokens.identity })
      .from(mailboxTokens)
      .where(isNull(mailboxTokens.revokedAt));

    if (tokenIdentities.length === 0) return;

    await db
      .insert(users)
      .values(
        tokenIdentities.map((t) => ({
          id: t.identity,
          displayName: t.identity,
          isAdmin: false,
          isAgent: true,
        })),
      )
      .onConflictDoNothing();

    for (const t of tokenIdentities) validMailboxes.add(t.identity);

    console.log(
      `[auth] Backfilled users from tokens (checked ${tokenIdentities.length})`,
    );
  } catch (err) {
    console.error("[auth] Failed to backfill users from tokens:", err);
  }
}

/**
 * Ensure the superuser's users row exists and is marked as admin.
 * Called at startup when SUPERUSER_NAME is configured.
 */
async function ensureSuperuser(name: string, displayName: string) {
  try {
    await db
      .insert(users)
      .values({
        id: name,
        displayName,
        isAdmin: true,
        isAgent: false,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: { isAdmin: true, updatedAt: new Date() },
      });
    validMailboxes.add(name);
    console.log(`[auth] Superuser "${name}" ensured in DB`);
  } catch (err) {
    console.error("[auth] Failed to ensure superuser in DB:", err);
  }
}

/** Return all non-archived users ordered by display name */
export async function listUsers() {
  return db
    .select()
    .from(users)
    .where(isNull(users.archivedAt))
    .orderBy(users.displayName);
}

export function isValidMailbox(name: string): boolean {
  return validMailboxes.has(name);
}

export function registerMailbox(name: string) {
  validMailboxes.add(name);
}

/** Remove an identity from the valid mailbox set (call when archiving/deactivating a user) */
export function deregisterMailbox(name: string) {
  validMailboxes.delete(name);
}

/** Check DB for a valid token — isAdmin is derived from users table */
async function authenticateFromDb(token: string): Promise<AuthContext | null> {
  // Check cache first
  const cached = dbCache.get(token);
  if (cached && cached.expires > Date.now()) {
    return cached.ctx;
  }

  try {
    const [row] = await db
      .select({
        id: mailboxTokens.id,
        identity: mailboxTokens.identity,
        expiresAt: mailboxTokens.expiresAt,
        isAdmin: users.isAdmin, // derived from users table, not mailboxTokens
      })
      .from(mailboxTokens)
      .innerJoin(users, eq(mailboxTokens.identity, users.id))
      .where(
        and(
          eq(mailboxTokens.token, token),
          isNull(mailboxTokens.revokedAt),
          isNull(users.archivedAt),
          or(
            isNull(mailboxTokens.expiresAt),
            gt(mailboxTokens.expiresAt, new Date()),
          ),
        ),
      )
      .limit(1);

    if (!row) {
      // Upgrade safety: token may exist from before the users table was populated.
      // Try to backfill a users row for this token's identity and retry once.
      const [tokenRow] = await db
        .select({ identity: mailboxTokens.identity, id: mailboxTokens.id })
        .from(mailboxTokens)
        .where(
          and(
            eq(mailboxTokens.token, token),
            isNull(mailboxTokens.revokedAt),
            or(
              isNull(mailboxTokens.expiresAt),
              gt(mailboxTokens.expiresAt, new Date()),
            ),
          ),
        )
        .limit(1);

      if (tokenRow) {
        await db
          .insert(users)
          .values({
            id: tokenRow.identity,
            displayName: tokenRow.identity,
            isAdmin: false,
            isAgent: true,
          })
          .onConflictDoNothing();

        // Retry the original join query once
        const [retryRow] = await db
          .select({
            id: mailboxTokens.id,
            identity: mailboxTokens.identity,
            expiresAt: mailboxTokens.expiresAt,
            isAdmin: users.isAdmin,
          })
          .from(mailboxTokens)
          .innerJoin(users, eq(mailboxTokens.identity, users.id))
          .where(
            and(
              eq(mailboxTokens.token, token),
              isNull(mailboxTokens.revokedAt),
              isNull(users.archivedAt),
              or(
                isNull(mailboxTokens.expiresAt),
                gt(mailboxTokens.expiresAt, new Date()),
              ),
            ),
          )
          .limit(1);

        if (retryRow) {
          validMailboxes.add(retryRow.identity);
          const ctx: AuthContext = {
            identity: retryRow.identity,
            isAdmin: retryRow.isAdmin,
            source: "db",
          };
          dbCache.set(token, { ctx, expires: Date.now() + DB_CACHE_TTL });
          return ctx;
        }
      }

      dbCache.set(token, { ctx: null, expires: Date.now() + DB_CACHE_TTL });
      return null;
    }

    // Update last_used_at (fire and forget)
    db.update(mailboxTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(mailboxTokens.id, row.id))
      .then(() => {})
      .catch(() => {});

    const ctx: AuthContext = {
      identity: row.identity,
      isAdmin: row.isAdmin,
      source: "db",
    };

    validMailboxes.add(row.identity);
    dbCache.set(token, { ctx, expires: Date.now() + DB_CACHE_TTL });
    return ctx;
  } catch (err) {
    console.error("[auth] DB token lookup failed:", err);
    return null;
  }
}

/** Authenticate a token — checks env (superuser) first, then DB */
export async function authenticateTokenAsync(
  token: string,
): Promise<AuthContext | null> {
  // Superuser env token takes priority
  const envAuth = envTokens.get(token);
  if (envAuth) return envAuth;

  // Fall back to DB tokens
  return authenticateFromDb(token);
}

/** Sync version — only checks env tokens (superuser) */
export function authenticateToken(token: string): AuthContext | null {
  return envTokens.get(token) || null;
}

/** Authenticate from H3 event — async, checks env + DB */
export async function authenticateEvent(
  event: H3Event,
): Promise<AuthContext | null> {
  const authHeader = getHeader(event, "authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authenticateTokenAsync(authHeader.slice(7));
}

export function initAuth() {
  envTokens.clear();

  const superuserToken = process.env.SUPERUSER_TOKEN;
  const superuserName = process.env.SUPERUSER_NAME?.toLowerCase().trim();

  if (superuserToken && superuserName) {
    const rawDisplayName = process.env.SUPERUSER_DISPLAY_NAME?.trim();
    // Default display name: title-case the name slug (e.g. "chris" → "Chris")
    const displayName =
      rawDisplayName ||
      superuserName.charAt(0).toUpperCase() + superuserName.slice(1);

    envTokens.set(superuserToken, {
      identity: superuserName,
      isAdmin: true,
      source: "env",
    });
    validMailboxes.add(superuserName);

    console.log(`[auth] Superuser token loaded for "${superuserName}"`);

    // Ensure superuser exists in DB (fire-and-forget)
    ensureSuperuser(superuserName, displayName).catch((err) =>
      console.error("[auth] ensureSuperuser failed:", err),
    );
  } else {
    console.warn(
      "[auth] SUPERUSER_TOKEN and/or SUPERUSER_NAME not set — no env-based admin access",
    );
  }

  // Load known users from DB into validMailboxes (fire-and-forget)
  loadUsersFromDb().catch((err) =>
    console.error("[auth] Failed to load users from DB:", err),
  );

  // Backfill missing users rows from mailbox tokens (upgrade safety)
  backfillUsersFromTokens().catch((err) =>
    console.error("[auth] Failed to backfill users from tokens:", err),
  );
}

/** Clear the DB token cache (e.g., after creating/revoking tokens or changing user admin status) */
export function clearAuthCache() {
  dbCache.clear();
}

initAuth();
