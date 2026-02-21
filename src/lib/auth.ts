import { config } from "dotenv";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { H3Event } from "h3";
import { getHeader } from "h3";
import { db } from "@/db";
import { mailboxTokens, users } from "@/db/schema";

config({ path: ".env" });
config({ path: "/etc/clawdbot/vault.env" });

export interface AuthContext {
  identity: string;
  isAdmin: boolean;
  source: "db" | "env";
}

// In-memory env token cache (loaded once at startup)
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
    console.log(`[auth] Loaded ${rows.length} user(s) from DB into validMailboxes`);
  } catch (err) {
    console.error("[auth] Failed to load users from DB:", err);
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

/** Check DB for a valid token */
async function authenticateFromDb(token: string): Promise<AuthContext | null> {
  // Check cache first
  const cached = dbCache.get(token);
  if (cached && cached.expires > Date.now()) {
    return cached.ctx;
  }

  try {
    const [row] = await db
      .select()
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

    if (!row) {
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

/** Authenticate a token — checks DB first, then env vars */
export async function authenticateTokenAsync(
  token: string,
): Promise<AuthContext | null> {
  // DB tokens take priority
  const dbAuth = await authenticateFromDb(token);
  if (dbAuth) return dbAuth;

  // Fall back to env tokens
  return envTokens.get(token) || null;
}

/** Sync version — only checks env tokens (for backwards compat) */
export function authenticateToken(token: string): AuthContext | null {
  return envTokens.get(token) || null;
}

/** Authenticate from H3 event — async, checks DB + env */
export async function authenticateEvent(
  event: H3Event,
): Promise<AuthContext | null> {
  const authHeader = getHeader(event, "authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authenticateTokenAsync(authHeader.slice(7));
}

export function initAuth() {
  envTokens.clear();

  // Support both HIVE_TOKEN_* (preferred) and MAILBOX_TOKEN_* (backward compat)
  for (const [key, value] of Object.entries(process.env)) {
    const prefixes = ["HIVE_TOKEN_", "MAILBOX_TOKEN_"];
    for (const prefix of prefixes) {
      if (key.startsWith(prefix) && !key.endsWith("_ADMIN") && value) {
        const name = key.slice(prefix.length).toLowerCase();
        if (name && name !== "s") {
          envTokens.set(value, {
            identity: name,
            isAdmin: false,
            source: "env",
          });
          validMailboxes.add(name);
        }
      }
    }
  }

  // Support both HIVE_TOKENS and MAILBOX_TOKENS (JSON maps)
  const tokensEnv = process.env.HIVE_TOKENS || process.env.MAILBOX_TOKENS;
  if (tokensEnv) {
    try {
      const mapping = JSON.parse(tokensEnv) as Record<string, string>;
      for (const [token, identity] of Object.entries(mapping)) {
        envTokens.set(token, {
          identity: identity.toLowerCase(),
          isAdmin: false,
          source: "env",
        });
        validMailboxes.add(identity.toLowerCase());
      }
    } catch (err) {
      console.error("[auth] Failed to parse HIVE_TOKENS/MAILBOX_TOKENS:", err);
    }
  }

  if (process.env.UI_MAILBOX_KEYS) {
    try {
      const parsed = JSON.parse(process.env.UI_MAILBOX_KEYS) as Record<
        string,
        { sender: string; admin?: boolean }
      >;
      for (const [key, info] of Object.entries(parsed)) {
        envTokens.set(key, {
          identity: info.sender.toLowerCase(),
          isAdmin: info.admin || false,
          source: "env",
        });
        validMailboxes.add(info.sender.toLowerCase());
      }
      console.log(
        `[auth] Loaded ${Object.keys(parsed).length} UI mailbox key(s)`,
      );
    } catch (err) {
      console.error("[auth] Failed to parse UI_MAILBOX_KEYS:", err);
    }
  }

  // Fallback: HIVE_TOKEN or MAILBOX_TOKEN (single token, identity from USER)
  const singleToken = process.env.HIVE_TOKEN || process.env.MAILBOX_TOKEN;
  if (singleToken && envTokens.size === 0) {
    const identity = process.env.USER?.toLowerCase() || "unknown";
    envTokens.set(singleToken, { identity, isAdmin: false, source: "env" });
    validMailboxes.add(identity);
  }

  if (process.env.MAILBOX_ADMIN_TOKEN) {
    envTokens.set(process.env.MAILBOX_ADMIN_TOKEN, {
      identity: "admin",
      isAdmin: true,
      source: "env",
    });
  }

  console.log(`[auth] Loaded ${envTokens.size} env token(s), DB auth enabled`);

  // Load known users from DB into validMailboxes (fire-and-forget)
  loadUsersFromDb().catch(err => console.error("[auth] Failed to load users from DB:", err));
}

/** Clear the DB token cache (e.g., after creating/revoking tokens) */
export function clearAuthCache() {
  dbCache.clear();
}

initAuth();
