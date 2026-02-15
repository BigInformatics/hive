import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { getMailboxKey, api } from "@/lib/api";
import { LoginGate } from "@/components/login-gate";
import { Nav } from "@/components/nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefreshCw, Radio, Plus, Copy, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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

interface Webhook {
  id: number;
  appName: string;
  token: string;
  title: string;
  owner: string;
  enabled: boolean;
  lastHitAt: string | null;
}

function BuzzView({ onLogout }: { onLogout: () => void }) {
  const [events, setEvents] = useState<BroadcastEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [appFilter, setAppFilter] = useState<string | null>(null);
  const [apps, setApps] = useState<string[]>([]);
  const [webhooksOpen, setWebhooksOpen] = useState(false);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [createWebhookOpen, setCreateWebhookOpen] = useState(false);

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
            variant="outline"
            size="sm"
            onClick={async () => {
              const res = await api.listWebhooks();
              setWebhooks(res.webhooks || []);
              setWebhooksOpen(true);
            }}
          >
            Webhooks
          </Button>
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

      {/* Webhooks list dialog */}
      <Dialog open={webhooksOpen} onOpenChange={setWebhooksOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Broadcast Webhooks</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-80 overflow-auto">
            {webhooks.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No webhooks yet
              </p>
            )}
            {webhooks.map((wh) => (
              <WebhookCard key={wh.id} webhook={wh} />
            ))}
          </div>
          <Button
            className="w-full"
            onClick={() => {
              setWebhooksOpen(false);
              setCreateWebhookOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1" /> Create Webhook
          </Button>
        </DialogContent>
      </Dialog>

      {/* Create webhook dialog */}
      <CreateWebhookDialog
        open={createWebhookOpen}
        onOpenChange={setCreateWebhookOpen}
        onCreated={async () => {
          const res = await api.listWebhooks();
          setWebhooks(res.webhooks || []);
          setWebhooksOpen(true);
        }}
      />
    </div>
  );
}

function WebhookCard({ webhook }: { webhook: Webhook }) {
  const [copied, setCopied] = useState(false);
  const ingestUrl = `https://messages.biginformatics.net/api/ingest/${webhook.appName}/${webhook.token}`;

  const copyUrl = () => {
    navigator.clipboard.writeText(ingestUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm">{webhook.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              App: <strong>{webhook.appName}</strong> · Owner: {webhook.owner}
            </p>
            <div className="flex items-center gap-1 mt-1.5">
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded truncate block max-w-xs">
                {ingestUrl}
              </code>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 shrink-0"
                onClick={copyUrl}
              >
                {copied ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </div>
          </div>
          <Badge variant={webhook.enabled ? "default" : "secondary"}>
            {webhook.enabled ? "Active" : "Disabled"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateWebhookDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [appName, setAppName] = useState("");
  const [title, setTitle] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setAppName("");
    setTitle("");
    setError("");
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appName.trim() || !title.trim()) return;

    // Validate app name format
    if (!/^[a-z][a-z0-9_-]*$/.test(appName.trim())) {
      setError("App name must be lowercase, start with a letter, and contain only a-z, 0-9, _ or -");
      return;
    }

    setSending(true);
    setError("");
    try {
      await api.createWebhook({
        appName: appName.trim(),
        title: title.trim(),
      });
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Webhook</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">App Name</p>
            <Input
              placeholder="my-app-name"
              value={appName}
              onChange={(e) => setAppName(e.target.value.toLowerCase())}
              required
              autoFocus
            />
            <p className="text-xs text-muted-foreground mt-1">
              Used in the webhook URL. Lowercase, no spaces.
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Display Title</p>
            <Input
              placeholder="My App Updates"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={sending || !appName.trim() || !title.trim()}>
              {sending ? "Creating..." : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
