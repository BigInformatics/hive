// In-memory presence tracking

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface PresenceEntry {
  lastSeen: number;
  source: string;
}

const presenceMap = new Map<string, PresenceEntry>();

export function updatePresence(identity: string, source = "api") {
  presenceMap.set(identity, { lastSeen: Date.now(), source });
}

export function getPresence(): Record<
  string,
  { online: boolean; lastSeen: string; source: string }
> {
  const now = Date.now();
  const result: Record<
    string,
    { online: boolean; lastSeen: string; source: string }
  > = {};

  for (const [identity, entry] of presenceMap) {
    result[identity] = {
      online: now - entry.lastSeen < TIMEOUT_MS,
      lastSeen: new Date(entry.lastSeen).toISOString(),
      source: entry.source,
    };
  }

  return result;
}

export function isOnline(identity: string): boolean {
  const entry = presenceMap.get(identity);
  if (!entry) return false;
  return Date.now() - entry.lastSeen < TIMEOUT_MS;
}
