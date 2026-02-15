import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { getMailboxKey, api } from "@/lib/api";
import { LoginGate } from "@/components/login-gate";
import { Nav } from "@/components/nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Mail, Clock } from "lucide-react";

export const Route = createFileRoute("/presence")({
  component: PresencePage,
});

interface UserPresence {
  online: boolean;
  lastSeen: string | null;
  source: string | null;
  unread: number;
}

const AVATARS: Record<string, string> = {
  chris: "/avatars/chris.jpg",
  clio: "/avatars/clio.png",
  domingo: "/avatars/domingo.jpg",
  zumie: "/avatars/zumie.png",
};

const ALL_USERS = ["chris", "clio", "domingo", "zumie"];

function getTimeSince(date: string | null): number {
  if (!date) return Infinity;
  return (Date.now() - new Date(date).getTime()) / 1000;
}

function formatLastSeen(date: string | null): string {
  if (!date) return "Never seen";
  const seconds = getTimeSince(date);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/** Returns opacity 1.0 (just seen) → 0.2 (long gone). Online = always 1.0 */
function getBorderOpacity(online: boolean, lastSeen: string | null): number {
  if (online) return 1.0;
  const seconds = getTimeSince(lastSeen);
  if (seconds < 300) return 0.8; // < 5 min
  if (seconds < 900) return 0.6; // < 15 min
  if (seconds < 3600) return 0.4; // < 1 hour
  if (seconds < 86400) return 0.25; // < 1 day
  return 0.15;
}

function PresencePage() {
  const [authed, setAuthed] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setAuthed(!!getMailboxKey());
    setChecked(true);
  }, []);

  if (!checked) return null;
  if (!authed) return <LoginGate onLogin={() => setAuthed(true)} />;

  return <PresenceView onLogout={() => setAuthed(false)} />;
}

function PresenceView({ onLogout }: { onLogout: () => void }) {
  const [presence, setPresence] = useState<Record<string, UserPresence>>({});
  const [loading, setLoading] = useState(false);

  const fetchPresence = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getPresence();
      setPresence(data);
    } catch (err) {
      console.error("Failed to fetch presence:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPresence();
  }, [fetchPresence]);

  // Auto-refresh every 15s
  useEffect(() => {
    const interval = setInterval(fetchPresence, 15000);
    return () => clearInterval(interval);
  }, [fetchPresence]);

  // Sort: online first, then by last seen
  const users = ALL_USERS.map((name) => ({
    name,
    info: presence[name] || {
      online: false,
      lastSeen: null,
      source: null,
      unread: 0,
    },
  })).sort((a, b) => {
    if (a.info.online !== b.info.online) return a.info.online ? -1 : 1;
    const aTime = a.info.lastSeen
      ? new Date(a.info.lastSeen).getTime()
      : 0;
    const bTime = b.info.lastSeen
      ? new Date(b.info.lastSeen).getTime()
      : 0;
    return bTime - aTime;
  });

  return (
    <div className="flex h-screen flex-col bg-background">
      <Nav onLogout={onLogout} />

      <div className="flex items-center justify-between border-b px-4 py-2">
        <span className="font-medium text-sm">Team Presence</span>
        <Button
          variant="ghost"
          size="icon"
          onClick={fetchPresence}
          disabled={loading}
        >
          <RefreshCw
            className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
          />
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-2xl mx-auto">
          {users.map(({ name, info }) => {
            const borderOpacity = getBorderOpacity(info.online, info.lastSeen);
            const avatar = AVATARS[name];

            return (
              <div
                key={name}
                className="flex flex-col items-center gap-3 p-4 rounded-xl"
              >
                {/* Avatar with green border */}
                <div
                  className="relative rounded-full p-1 transition-all duration-500"
                  style={{
                    boxShadow: `0 0 0 3px rgba(34, 197, 94, ${borderOpacity})`,
                  }}
                >
                  {avatar ? (
                    <img
                      src={avatar}
                      alt={name}
                      className="h-20 w-20 rounded-full object-cover"
                    />
                  ) : (
                    <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center text-2xl font-bold uppercase text-muted-foreground">
                      {name[0]}
                    </div>
                  )}

                  {/* Online dot */}
                  {info.online && (
                    <span className="absolute bottom-1 right-1 h-4 w-4 rounded-full bg-green-500 border-2 border-background" />
                  )}
                </div>

                {/* Name */}
                <p className="font-semibold capitalize text-sm">{name}</p>

                {/* Status line */}
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  {info.online ? (
                    <>
                      <span className="text-green-500">●</span>
                      Online
                      {info.source && (
                        <span className="text-muted-foreground/60">
                          via {info.source}
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <Clock className="h-3 w-3" />
                      {formatLastSeen(info.lastSeen)}
                    </>
                  )}
                </p>

                {/* Unread badge */}
                {info.unread > 0 && (
                  <Badge
                    variant="destructive"
                    className="flex items-center gap-1"
                  >
                    <Mail className="h-3 w-3" />
                    {info.unread}
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
