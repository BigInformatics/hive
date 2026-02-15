import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { getMailboxKey, api } from "@/lib/api";
import { LoginGate } from "@/components/login-gate";
import { Nav } from "@/components/nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Timer,
  Plus,
  Power,
  PowerOff,
  Play,
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
            <TabsTrigger value="recurring" className="gap-1.5">
              <Timer className="h-3.5 w-3.5" /> Recurring
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

          <TabsContent value="recurring" className="mt-4">
            <RecurringPanel projects={stats?.projects || []} />
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

  const [newAppName, setNewAppName] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAppName.trim() || !newTitle.trim()) return;
    setCreating(true);
    try {
      await api.createWebhook({ appName: newAppName.trim(), title: newTitle.trim() });
      setNewAppName("");
      setNewTitle("");
      onRefresh();
    } catch (err) {
      console.error("Failed to create webhook:", err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Inline create form */}
      <Card>
        <CardContent className="p-3">
          <form onSubmit={handleCreate} className="flex items-end gap-2">
            <div className="flex-1">
              <p className="text-xs text-muted-foreground mb-1">App name (slug)</p>
              <input
                className="w-full rounded-md border bg-transparent px-3 py-1.5 text-sm"
                placeholder="e.g. onedev"
                value={newAppName}
                onChange={(e) => setNewAppName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                required
              />
            </div>
            <div className="flex-1">
              <p className="text-xs text-muted-foreground mb-1">Title</p>
              <input
                className="w-full rounded-md border bg-transparent px-3 py-1.5 text-sm"
                placeholder="e.g. OneDev Notifications"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                required
              />
            </div>
            <Button type="submit" size="sm" disabled={creating}>
              {creating ? "Creating..." : "Create"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {webhooks.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          No webhooks configured yet.
        </p>
      )}

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
              <div className="flex gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => copyUrl(wh)}
                >
                  {copied === wh.id ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive"
                  onClick={async () => {
                    if (!confirm(`Delete webhook "${wh.title}"?`)) return;
                    try {
                      await api.deleteWebhook(Number(wh.id));
                      onRefresh();
                    } catch (err) {
                      console.error("Failed to delete webhook:", err);
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ─── Recurring Templates Panel ─── */

interface RecurringTemplate {
  id: string;
  projectId: string | null;
  title: string;
  detail: string | null;
  assigneeUserId: string | null;
  creatorUserId: string;
  cronExpr: string;
  timezone: string;
  initialStatus: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
}

const CRON_PRESETS = [
  { label: "Every day 9 AM", value: "0 9 * * *" },
  { label: "Every Monday 9 AM", value: "0 9 * * 1" },
  { label: "Every weekday 9 AM", value: "0 9 * * 1-5" },
  { label: "Every 1st of month", value: "0 9 1 * *" },
  { label: "Every Friday 4 PM", value: "0 16 * * 5" },
];

const KNOWN_USERS = ["chris", "clio", "domingo", "zumie"];

function RecurringPanel({
  projects,
}: {
  projects: Array<{ id: string; title: string; color: string }>;
}) {
  const [templates, setTemplates] = useState<RecurringTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listRecurringTemplates(true);
      setTemplates(res.templates || []);
    } catch (err) {
      console.error("Failed to fetch templates:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await api.updateRecurringTemplate(id, { enabled });
      fetchTemplates();
    } catch (err) {
      console.error("Failed to toggle template:", err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this recurring template?")) return;
    try {
      await api.deleteRecurringTemplate(id);
      fetchTemplates();
    } catch (err) {
      console.error("Failed to delete template:", err);
    }
  };

  const handleTick = async () => {
    try {
      const result = await api.tickRecurring();
      alert(`Tick complete: ${result.created} tasks created, ${result.errors} errors`);
      fetchTemplates();
    } catch (err) {
      console.error("Failed to tick:", err);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Recurring templates automatically create tasks on a schedule.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleTick} title="Run tick now — creates any due tasks">
            <Play className="h-3.5 w-3.5 mr-1" /> Tick Now
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New Template
          </Button>
        </div>
      </div>

      {templates.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No recurring templates yet.
        </p>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => {
            const project = projects.find((p) => p.id === t.projectId);
            return (
              <Card key={t.id} className={!t.enabled ? "opacity-60" : ""}>
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm">{t.title}</p>
                        <Badge variant={t.enabled ? "default" : "secondary"} className="text-xs">
                          {t.enabled ? "Active" : "Disabled"}
                        </Badge>
                        {project && (
                          <Badge variant="outline" className="text-xs gap-1">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: project.color }} />
                            {project.title}
                          </Badge>
                        )}
                        {t.assigneeUserId && (
                          <Badge variant="outline" className="text-xs">
                            → {t.assigneeUserId}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="font-mono">{t.cronExpr}</span>
                        <span>→ {t.initialStatus}</span>
                        <span>{t.timezone}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                        {t.lastRunAt && (
                          <span>Last: {new Date(t.lastRunAt).toLocaleString()}</span>
                        )}
                        {t.nextRunAt && (
                          <span>Next: {new Date(t.nextRunAt).toLocaleString()}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={async () => {
                          try {
                            await api.createRecurringTemplate({
                              title: t.title,
                              detail: t.detail || undefined,
                              cronExpr: t.cronExpr,
                              timezone: t.timezone,
                              projectId: t.projectId || undefined,
                              initialStatus: t.initialStatus,
                            });
                            fetchTemplates();
                          } catch (err) {
                            console.error("Failed to duplicate:", err);
                          }
                        }}
                        title="Duplicate (unassigned)"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleToggle(t.id, !t.enabled)}
                        title={t.enabled ? "Disable" : "Enable"}
                      >
                        {t.enabled ? (
                          <Power className="h-4 w-4 text-green-500" />
                        ) : (
                          <PowerOff className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => handleDelete(t.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CreateRecurringDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projects={projects}
        onCreated={fetchTemplates}
      />
    </div>
  );
}

function CreateRecurringDialog({
  open,
  onOpenChange,
  projects,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Array<{ id: string; title: string; color: string }>;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [cronExpr, setCronExpr] = useState("0 9 * * 1");
  const [projectId, setProjectId] = useState("");
  const [assignee, setAssignee] = useState("");
  const [initialStatus, setInitialStatus] = useState("ready");
  const [sending, setSending] = useState(false);

  const ALL_STATUSES = [
    { value: "queued", label: "Queued" },
    { value: "ready", label: "Ready" },
    { value: "in_progress", label: "In Progress" },
  ];

  const reset = () => {
    setTitle("");
    setDetail("");
    setCronExpr("0 9 * * 1");
    setProjectId("");
    setAssignee("");
    setInitialStatus("ready");
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !cronExpr.trim()) return;

    setSending(true);
    try {
      await api.createRecurringTemplate({
        title: title.trim(),
        detail: detail.trim() || undefined,
        cronExpr: cronExpr.trim(),
        projectId: projectId || undefined,
        assigneeUserId: assignee || undefined,
        initialStatus: initialStatus || undefined,
      });
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err) {
      console.error("Failed to create template:", err);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>New Recurring Template</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleCreate} className="space-y-4">
          <Input
            placeholder="Task title (created each time)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus
          />
          <Textarea
            placeholder="Details (optional)"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={2}
          />

          {/* Cron expression */}
          <div>
            <p className="text-xs text-muted-foreground mb-1">Schedule (cron)</p>
            <Input
              placeholder="0 9 * * 1"
              value={cronExpr}
              onChange={(e) => setCronExpr(e.target.value)}
              className="font-mono"
              required
            />
            <div className="flex gap-1 mt-1.5 flex-wrap">
              {CRON_PRESETS.map((p) => (
                <Button
                  key={p.value}
                  type="button"
                  variant={cronExpr === p.value ? "secondary" : "outline"}
                  size="sm"
                  className="text-xs h-6"
                  onClick={() => setCronExpr(p.value)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <p className="text-xs text-muted-foreground mb-1">Project</p>
              <select
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <p className="text-xs text-muted-foreground mb-1">Assignee</p>
              <select
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              >
                <option value="">Unassigned</option>
                {KNOWN_USERS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-1">Initial status</p>
            <div className="flex gap-1">
              {ALL_STATUSES.map((s) => (
                <Button
                  key={s.value}
                  type="button"
                  variant={initialStatus === s.value ? "secondary" : "outline"}
                  size="sm"
                  className="text-xs"
                  onClick={() => setInitialStatus(s.value)}
                >
                  {s.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={sending || !title.trim() || !cronExpr.trim()}>
              {sending ? "Creating..." : "Create Template"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
