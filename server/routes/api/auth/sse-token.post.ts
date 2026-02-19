import { randomBytes } from "node:crypto";
import { defineEventHandler } from "h3";
import { authenticateEvent } from "@/lib/auth";

// In-memory short-lived SSE token store
const sseTokens = new Map<
  string,
  { identity: string; isAdmin: boolean; expiresAt: number }
>();

const SSE_TOKEN_TTL = 5 * 60_000; // 5 minutes

// Cleanup expired tokens every minute
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of sseTokens) {
    if (data.expiresAt < now) sseTokens.delete(token);
  }
}, 60_000);

/** Validate and consume an SSE token (single-use or time-limited) */
export function validateSseToken(
  token: string,
): { identity: string; isAdmin: boolean } | null {
  const data = sseTokens.get(token);
  if (!data) return null;
  if (data.expiresAt < Date.now()) {
    sseTokens.delete(token);
    return null;
  }
  // Don't delete — allow reuse within the TTL window (SSE may reconnect)
  return { identity: data.identity, isAdmin: data.isAdmin };
}

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sseToken = randomBytes(32).toString("hex");
  sseTokens.set(sseToken, {
    identity: auth.identity,
    isAdmin: auth.isAdmin,
    expiresAt: Date.now() + SSE_TOKEN_TTL,
  });

  return {
    token: sseToken,
    expiresIn: SSE_TOKEN_TTL / 1000,
    usage: "Pass as ?token=<value> to /api/sse",
  };
});
