import { defineEventHandler, getRouterParam } from "h3";
import { authenticateEvent } from "@/lib/auth";

// In-memory viewer tracking — viewers expire after 45s without a heartbeat
const pageViewers = new Map<string, Map<string, number>>(); // pageId -> Map<identity, lastSeen>

const STALE_MS = 45_000;

export function getActiveViewers(pageId: string): string[] {
  const viewers = pageViewers.get(pageId);
  if (!viewers) return [];
  const now = Date.now();
  const active: string[] = [];
  for (const [identity, lastSeen] of viewers) {
    if (now - lastSeen < STALE_MS) {
      active.push(identity);
    } else {
      viewers.delete(identity);
    }
  }
  return active;
}

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const pageId = getRouterParam(event, "id");
  if (!pageId) {
    return new Response(JSON.stringify({ error: "Missing page id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!pageViewers.has(pageId)) {
    pageViewers.set(pageId, new Map());
  }
  pageViewers.get(pageId)?.set(auth.identity, Date.now());

  return { viewers: getActiveViewers(pageId) };
});
