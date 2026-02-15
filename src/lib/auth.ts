import { config } from "dotenv";
import type { H3Event } from "h3";
import { getHeader } from "h3";

config({ path: ".env" });
config({ path: "/etc/clawdbot/vault.env" });

export interface AuthContext {
  identity: string;
  isAdmin: boolean;
}

const tokens = new Map<string, AuthContext>();
const validMailboxes = new Set(["chris", "clio", "domingo", "zumie"]);

export function isValidMailbox(name: string): boolean {
  return validMailboxes.has(name);
}

export function authenticateToken(token: string): AuthContext | null {
  return tokens.get(token) || null;
}

/** Authenticate from H3 event (Bun-safe — no event.node.req) */
export function authenticateEvent(event: H3Event): AuthContext | null {
  const authHeader = getHeader(event, "authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authenticateToken(authHeader.slice(7));
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

  // UI_MAILBOX_KEYS format: {"key1":{"sender":"chris","admin":true},...}
  if (process.env.UI_MAILBOX_KEYS) {
    try {
      const parsed = JSON.parse(process.env.UI_MAILBOX_KEYS) as Record<
        string,
        { sender: string; admin?: boolean }
      >;
      for (const [key, info] of Object.entries(parsed)) {
        tokens.set(key, {
          identity: info.sender.toLowerCase(),
          isAdmin: info.admin || false,
        });
        validMailboxes.add(info.sender.toLowerCase());
      }
      console.log(`[auth] Loaded ${Object.keys(parsed).length} UI mailbox key(s)`);
    } catch (err) {
      console.error("[auth] Failed to parse UI_MAILBOX_KEYS:", err);
    }
  }

  // Bare MAILBOX_TOKEN fallback for local dev
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
