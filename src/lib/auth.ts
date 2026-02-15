import { config } from "dotenv";

config({ path: ".env" });
config({ path: "/etc/clawdbot/vault.env" });

export interface AuthContext {
  identity: string;
  isAdmin: boolean;
}

// Token -> identity mapping
const tokens = new Map<string, AuthContext>();

// Valid mailbox names
const validMailboxes = new Set(["chris", "clio", "domingo", "zumie"]);

export function isValidMailbox(name: string): boolean {
  return validMailboxes.has(name);
}

/** Authenticate from a bearer token string (without "Bearer " prefix) */
export function authenticateToken(token: string): AuthContext | null {
  return tokens.get(token) || null;
}

/** Authenticate from an Authorization header value */
export function authenticate(authHeader: string | null | undefined): AuthContext | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authenticateToken(authHeader.slice(7));
}

/** Extract auth from H3 event */
export function authenticateEvent(event: { node: { req: { headers: Record<string, string | string[] | undefined> } } }): AuthContext | null {
  const header = event.node.req.headers.authorization;
  const authStr = Array.isArray(header) ? header[0] : header;
  return authenticate(authStr);
}

export function initAuth() {
  tokens.clear();

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("MAILBOX_TOKEN_") && !key.endsWith("_ADMIN") && value) {
      const name = key.slice(14).toLowerCase();
      if (name && name !== "s") {
        tokens.set(value, { identity: name, isAdmin: false });
        validMailboxes.add(name);
      }
    }
  }

  if (process.env.MAILBOX_TOKENS) {
    try {
      const mapping = JSON.parse(process.env.MAILBOX_TOKENS) as Record<string, string>;
      for (const [token, identity] of Object.entries(mapping)) {
        tokens.set(token, { identity: identity.toLowerCase(), isAdmin: false });
        validMailboxes.add(identity.toLowerCase());
      }
    } catch (err) {
      console.error("[auth] Failed to parse MAILBOX_TOKENS:", err);
    }
  }

  // Bare MAILBOX_TOKEN — treat as the current user's token
  // (useful for local dev with vault.env)
  if (process.env.MAILBOX_TOKEN && tokens.size === 0) {
    const identity = process.env.USER?.toLowerCase() || "unknown";
    tokens.set(process.env.MAILBOX_TOKEN, { identity, isAdmin: false });
    validMailboxes.add(identity);
  }

  if (process.env.MAILBOX_ADMIN_TOKEN) {
    tokens.set(process.env.MAILBOX_ADMIN_TOKEN, {
      identity: "admin",
      isAdmin: true,
    });
  }

  console.log(`[auth] Loaded ${tokens.size} token(s)`);
}

initAuth();
