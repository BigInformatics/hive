import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { getMailboxKey, api } from "@/lib/api";
import { LoginGate } from "@/components/login-gate";
import { Nav } from "@/components/nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  RefreshCw,
  Activity,
  Users,
  MessageSquare,
  Radio,
  LayoutList,
  Webhook,
  Copy,
  Check,
  Trash2,
} from "lucide-react";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

interface SystemStats {
  presence: Record<string, { online: boolean; lastSeen: string | null; unread: number }>;
  webhooks: Array<{
    id: string;
    appName: string;
    title: string;
    owner: string;
    token: string;
    enabled: boolean;
    createdAt: string;
  }>;
  projects: Array<{
    id: string;
    title: string;
    color: string;
  }>;
  taskCounts: Record<string, number>;
}

function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setAuthed(!!getMailboxKey());
    setChecked(true);
  }, []);

  if (!checked) return null;
  if (!authed) return <LoginGate onLogin={() => setAuthed(true)} />;

  return <AdminView onLogout={() => setAuthed(false)} />;
}

function AdminView({ onLogout }: { onLogout: () => void }) {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const [presence, webhooks, projects, tasks] = await Promise.all([
        api.getPresence(),
        api.listWebhooks().catch(() => ({ webhooks: [] })),
        api.listProjects().catch(() => ({ projects: [] })),
        api.listTasks({ includeCompleted: true }).catch(() => ({ tasks: [] })),
      ]);

      // Count tasks by status
      const taskCounts: Record<string, number> = {};
      for (const t of tasks.tasks || []) {
        taskCounts[t.status] = (taskCounts[t.status] || 0) + 1;
      }

      setStats({
        presence,
        webhooks: webhooks.webhooks || [],
        projects: projects.projects || [],
        taskCounts,
      });
    } catch (err) {
      console.error("Failed to fetch admin stats:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const onlineCount = stats
    ? Object.values(stats.presence).filter((p: any) => p.online).length
    : 0;
  const totalTasks = stats
    ? Object.values(stats.taskCounts).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <div className="flex h-screen flex-col bg-background">
      <Nav onLogout={onLogout} />

      <div className="flex items-center justify-between border-b px-4 py-2">
        <span className="font-medium text-sm">System Administration</span>
        <Button
          variant="ghost"
          size="icon"
          onClick={fetchStats}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        {/* Overview cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4">
          <StatCard
            icon={<Users className="h-4 w-4 text-green-500" />}
            label="Online"
            value={`${onlineCount} / 4`}
          />
          <StatCard
            icon={<MessageSquare className="h-4 w-4 text-sky-500" />}
            label="Unread Messages"
            value={stats ? Object.values(stats.presence).reduce((sum: number, p: any) => sum + (p.unread || 0), 0).toString() : "—"}
          />
          <StatCard
            icon={<LayoutList className="h-4 w-4 text-purple-500" />}
            label="Active Tasks"
            value={stats ? (totalTasks - (stats.taskCounts.complete || 0)).toString() : "—"}
          />
          <StatCard
            icon={<Radio className="h-4 w-4 text-amber-500" />}
            label="Webhooks"
            value={stats?.webhooks.length.toString() || "—"}
          />
        </div>

        <Tabs defaultValue="presence" className="px-4 pb-4">
          <TabsList>
            <TabsTrigger value="presence" className="gap-1.5">
              <Users className="h-3.5 w-3.5" /> Presence
            </TabsTrigger>
            <TabsTrigger value="tasks" className="gap-1.5">
              <LayoutList className="h-3.5 w-3.5" /> Tasks
            </TabsTrigger>
            <TabsTrigger value="webhooks" className="gap-1.5">
              <Webhook className="h-3.5 w-3.5" /> Webhooks
            </TabsTrigger>
          </TabsList>

          <TabsContent value="presence" className="mt-4">
            <PresencePanel presence={stats?.presence || {}} />
          </TabsContent>

          <TabsContent value="tasks" className="mt-4">
            <TasksPanel
              taskCounts={stats?.taskCounts || {}}
              projects={stats?.projects || []}
            />
          </TabsContent>

          <TabsContent value="webhooks" className="mt-4">
            <WebhooksPanel webhooks={stats?.webhooks || []} onRefresh={fetchStats} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          {icon}
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

const AVATARS: Record<string, string> = {
  chris: "/avatars/chris.jpg",
  clio: "/avatars/clio.png",
  domingo: "/avatars/domingo.jpg",
  zumie: "/avatars/zumie.png",
};

function PresencePanel({
  presence,
}: {
  presence: Record<string, { online: boolean; lastSeen: string | null; unread: number }>;
}) {
  const users = Object.entries(presence).sort(([, a], [, b]) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return 0;
  });

  if (users.length === 0) {
    return <p className="text-sm text-muted-foreground">No presence data</p>;
  }

  return (
    <div className="space-y-2">
      {users.map(([name, info]) => (
        <Card key={name}>
          <CardContent className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {AVATARS[name] ? (
                <img src={AVATARS[name]} alt={name} className="h-8 w-8 rounded-full" />
              ) : (
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-sm font-bold uppercase">
                  {name[0]}
                </div>
              )}
              <div>
                <p className="font-medium text-sm capitalize">{name}</p>
                <p className="text-xs text-muted-foreground">
                  {info.online ? (
                    <span className="text-green-500">● Online</span>
                  ) : info.lastSeen ? (
                    `Last seen: ${new Date(info.lastSeen).toLocaleString()}`
                  ) : (
                    "Never seen"
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {info.unread > 0 && (
                <Badge variant="destructive">{info.unread} unread</Badge>
              )}
              <Badge variant={info.online ? "default" : "secondary"}>
                {info.online ? "Online" : "Offline"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  queued: { label: "Queued", color: "text-muted-foreground" },
  ready: { label: "Ready", color: "text-green-500" },
  in_progress: { label: "In Progress", color: "text-sky-500" },
  holding: { label: "Holding", color: "text-amber-500" },
  review: { label: "Review", color: "text-purple-500" },
  complete: { label: "Complete", color: "text-green-500" },
};

function TasksPanel({
  taskCounts,
  projects,
}: {
  taskCounts: Record<string, number>;
  projects: Array<{ id: string; title: string; color: string }>;
}) {
  const statuses = ["queued", "ready", "in_progress", "holding", "review", "complete"];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium mb-2">Tasks by Status</h3>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {statuses.map((s) => {
            const config = STATUS_LABELS[s];
            const count = taskCounts[s] || 0;
            return (
              <Card key={s}>
                <CardContent className="p-3 text-center">
                  <p className={`text-2xl font-bold ${config?.color}`}>{count}</p>
                  <p className="text-xs text-muted-foreground">{config?.label || s}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {projects.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">Projects</h3>
          <div className="space-y-1.5">
            {projects.map((p) => (
              <Card key={p.id}>
                <CardContent className="p-3 flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: p.color }} />
                  <span className="text-sm font-medium">{p.title}</span>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WebhooksPanel({
  webhooks,
  onRefresh,
}: {
  webhooks: Array<{
    id: string;
    appName: string;
    title: string;
    owner: string;
    token: string;
    enabled: boolean;
    createdAt: string;
  }>;
  onRefresh: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const copyUrl = (wh: typeof webhooks[0]) => {
    const url = `https://messages.biginformatics.net/api/ingest/${wh.appName}/${wh.token}`;
    navigator.clipboard.writeText(url);
    setCopied(wh.id);
    setTimeout(() => setCopied(null), 2000);
  };

  if (webhooks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No webhooks configured. Create one from the Buzz page.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {webhooks.map((wh) => (
        <Card key={wh.id}>
          <CardContent className="p-3">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm">{wh.title}</p>
                  <Badge variant={wh.enabled ? "default" : "secondary"} className="text-xs">
                    {wh.enabled ? "Active" : "Disabled"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  App: <strong>{wh.appName}</strong> · Owner: {wh.owner} · Created: {new Date(wh.createdAt).toLocaleDateString()}
                </p>
                <p className="text-xs text-muted-foreground mt-1 font-mono">
                  /api/ingest/{wh.appName}/{wh.token}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => copyUrl(wh)}
              >
                {copied === wh.id ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
