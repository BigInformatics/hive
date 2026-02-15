import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { getMailboxKey, api } from "@/lib/api";
import { LoginGate } from "@/components/login-gate";
import { Nav } from "@/components/nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, Circle } from "lucide-react";

export const Route = createFileRoute("/presence")({
  component: PresencePage,
});

interface UserPresence {
  online: boolean;
  lastSeen: string | null;
  source: string | null;
  unread: number;
}

function timeAgo(date: string | null): string {
  if (!date) return "never";
  const seconds = Math.floor(
    (Date.now() - new Date(date).getTime()) / 1000,
  );
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
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

  const users = Object.entries(presence).sort(([, a], [, b]) => {
    // Online first, then by unread count
    if (a.online !== b.online) return a.online ? -1 : 1;
    return b.unread - a.unread;
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
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="grid gap-3 max-w-lg mx-auto">
          {users.length === 0 && !loading && (
            <p className="text-center text-muted-foreground py-8">
              No presence data yet
            </p>
          )}
          {users.map(([name, info]) => (
            <Card key={name}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <Circle
                    className={`h-3 w-3 ${
                      info.online
                        ? "fill-green-500 text-green-500"
                        : "fill-muted text-muted"
                    }`}
                  />
                  <div>
                    <p className="font-medium capitalize">{name}</p>
                    <p className="text-xs text-muted-foreground">
                      {info.online
                        ? `Online via ${info.source || "api"}`
                        : `Last seen ${timeAgo(info.lastSeen)}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {info.unread > 0 && (
                    <Badge variant="destructive">{info.unread}</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
