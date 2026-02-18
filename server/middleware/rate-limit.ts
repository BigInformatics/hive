import { defineEventHandler, getRequestPath, getRequestHeader, createError } from "h3";

interface RateBucket {
  count: number;
  resetAt: number;
}

// In-memory rate limit store: key → bucket
const store = new Map<string, RateBucket>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of store) {
    if (bucket.resetAt < now) store.delete(key);
  }
}, 5 * 60_000);

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

// Route-specific limits
const ROUTE_LIMITS: [RegExp, RateLimitConfig][] = [
  // Auth endpoints — tight limits to prevent brute force
  [/^\/api\/auth\/register/, { maxRequests: 5, windowMs: 60_000 }],
  [/^\/api\/auth\/verify/, { maxRequests: 20, windowMs: 60_000 }],
  [/^\/api\/auth\/invites/, { maxRequests: 10, windowMs: 60_000 }],
  // Message send — moderate
  [/^\/api\/mailboxes\/[^/]+\/messages$/, { maxRequests: 30, windowMs: 60_000 }],
  // Wake/presence — moderate
  [/^\/api\/wake/, { maxRequests: 20, windowMs: 60_000 }],
  [/^\/api\/presence/, { maxRequests: 30, windowMs: 60_000 }],
  // SSE — limit connections
  [/^\/api\/sse/, { maxRequests: 5, windowMs: 60_000 }],
  // Broadcast ingest — moderate
  [/^\/api\/ingest/, { maxRequests: 30, windowMs: 60_000 }],
  // Default API — generous
  [/^\/api\//, { maxRequests: 60, windowMs: 60_000 }],
];

function getLimit(path: string): RateLimitConfig | null {
  for (const [pattern, config] of ROUTE_LIMITS) {
    if (pattern.test(path)) return config;
  }
  return null;
}

function getClientKey(event: any): string {
  // Prefer auth identity if available (set by auth middleware)
  // Fall back to IP
  const forwarded = getRequestHeader(event, "x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  return ip;
}

export default defineEventHandler((event) => {
  const path = getRequestPath(event);

  // Skip non-API routes (static assets, pages)
  if (!path.startsWith("/api/")) return;

  // Skip health check
  if (path === "/api/health") return;

  // Skip skill docs (public reference)
  if (path.startsWith("/api/skill")) return;

  const limit = getLimit(path);
  if (!limit) return;

  const clientKey = getClientKey(event);
  const bucketKey = `${clientKey}:${path.replace(/\/[a-f0-9-]{8,}/g, "/:id")}`;

  const now = Date.now();
  let bucket = store.get(bucketKey);

  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + limit.windowMs };
    store.set(bucketKey, bucket);
  }

  bucket.count++;

  // Set rate limit headers
  event.node?.res?.setHeader?.("X-RateLimit-Limit", String(limit.maxRequests));
  event.node?.res?.setHeader?.("X-RateLimit-Remaining", String(Math.max(0, limit.maxRequests - bucket.count)));
  event.node?.res?.setHeader?.("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count > limit.maxRequests) {
    throw createError({
      statusCode: 429,
      statusMessage: "Too Many Requests",
      message: `Rate limit exceeded. Try again in ${Math.ceil((bucket.resetAt - now) / 1000)}s.`,
    });
  }
});
