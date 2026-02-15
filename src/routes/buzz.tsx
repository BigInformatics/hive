import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { getMailboxKey, api } from "@/lib/api";
import { LoginGate } from "@/components/login-gate";
import { Nav } from "@/components/nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefreshCw, Radio, Filter } from "lucide-react";

export const Route = createFileRoute("/buzz")({
  component: BuzzPage,
});

interface BroadcastEvent {
  id: number;
  appName: string;
  title: string;
  forUsers: string | null;
  receivedAt: string;
  contentType: string | null;
  bodyText: string | null;
  bodyJson: unknown | null;
}

function timeAgo(date: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(date).getTime()) / 1000,
  );
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function BuzzPage() {
  const [authed, setAuthed] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setAuthed(!!getMailboxKey());
    setChecked(true);
  }, []);

  if (!checked) return null;
  if (!authed) return <LoginGate onLogin={() => setAuthed(true)} />;

  return <BuzzView onLogout={() => setAuthed(false)} />;
}

function BuzzCard({
  event: evt,
  expanded: defaultExpanded,
}: {
  event: BroadcastEvent;
  expanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasBody = !!(evt.bodyText || evt.bodyJson);

  return (
    <Card
      className={`overflow-hidden ${hasBody ? "cursor-pointer" : ""}`}
      onClick={() => hasBody && setExpanded(!expanded)}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs shrink-0">
                {evt.appName}
              </Badge>
              <span className="font-medium text-sm truncate">
                {evt.title}
              </span>
              {hasBody && !expanded && (
                <span className="text-xs text-muted-foreground">▸</span>
              )}
              {hasBody && expanded && (
                <span className="text-xs text-muted-foreground">▾</span>
              )}
            </div>
            {expanded && evt.bodyText && (
              <pre className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap font-sans">
                {evt.bodyText}
              </pre>
            )}
            {expanded && evt.bodyJson && !evt.bodyText && (
              <pre className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap font-mono bg-muted/50 rounded p-2 max-h-64 overflow-auto">
                {typeof evt.bodyJson === "object"
                  ? JSON.stringify(evt.bodyJson, null, 2)
                  : String(evt.bodyJson)}
              </pre>
            )}
          </div>
          <span className="text-xs text-muted-foreground shrink-0">
            {timeAgo(evt.receivedAt)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function BuzzView({ onLogout }: { onLogout: () => void }) {
  const [events, setEvents] = useState<BroadcastEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [appFilter, setAppFilter] = useState<string | null>(null);
  const [apps, setApps] = useState<string[]>([]);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.listBroadcastEvents(
        appFilter || undefined,
      );
      const evts = result.events || [];
      setEvents(evts);
      // Extract unique app names
      const uniqueApps = [...new Set(evts.map((e: BroadcastEvent) => e.appName))];
      if (!appFilter) setApps(uniqueApps);
    } catch (err) {
      console.error("Failed to fetch broadcast events:", err);
    } finally {
      setLoading(false);
    }
  }, [appFilter]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(fetchEvents, 30000);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  return (
    <div className="flex h-screen flex-col bg-background">
      <Nav onLogout={onLogout} />

      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">Broadcast Feed</span>
          {events.length > 0 && (
            <Badge variant="secondary">{events.length}</Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {apps.length > 1 && (
            <div className="flex gap-1 mr-2">
              <Button
                variant={appFilter === null ? "default" : "ghost"}
                size="sm"
                className="text-xs h-7"
                onClick={() => setAppFilter(null)}
              >
                All
              </Button>
              {apps.map((app) => (
                <Button
                  key={app}
                  variant={appFilter === app ? "default" : "ghost"}
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => setAppFilter(app)}
                >
                  {app}
                </Button>
              ))}
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={fetchEvents}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-2 p-4">
          {events.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Radio className="h-8 w-8 mb-2 opacity-50" />
              <p>No broadcast events yet</p>
            </div>
          )}
          {events.map((evt, idx) => (
            <BuzzCard key={evt.id} event={evt} expanded={idx === 0} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
