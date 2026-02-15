import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { getMailboxKey, api } from "@/lib/api";
import { LoginGate } from "@/components/login-gate";
import { Nav } from "@/components/nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  RefreshCw,
  Plus,
  Circle,
  CheckCircle2,
  Clock,
  Pause,
  Eye,
  PlayCircle,
  User,
} from "lucide-react";

export const Route = createFileRoute("/swarm")({
  component: SwarmPage,
});

interface SwarmTask {
  id: string;
  projectId: string | null;
  title: string;
  detail: string | null;
  creatorUserId: string;
  assigneeUserId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface SwarmProject {
  id: string;
  title: string;
  color: string;
  description: string | null;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; icon: typeof Circle; color: string; bgColor: string }
> = {
  queued: {
    label: "Queued",
    icon: Circle,
    color: "text-muted-foreground",
    bgColor: "bg-muted/50",
  },
  ready: {
    label: "Ready",
    icon: PlayCircle,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
  },
  in_progress: {
    label: "In Progress",
    icon: Clock,
    color: "text-sky-500",
    bgColor: "bg-sky-500/10",
  },
  holding: {
    label: "Holding",
    icon: Pause,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
  },
  review: {
    label: "Review",
    icon: Eye,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
  },
  complete: {
    label: "Complete",
    icon: CheckCircle2,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
  },
};

const ALL_STATUSES = [
  "queued",
  "ready",
  "in_progress",
  "holding",
  "review",
  "complete",
];

function SwarmPage() {
  const [authed, setAuthed] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setAuthed(!!getMailboxKey());
    setChecked(true);
  }, []);

  if (!checked) return null;
  if (!authed) return <LoginGate onLogin={() => setAuthed(true)} />;

  return <SwarmView onLogout={() => setAuthed(false)} />;
}

function SwarmView({ onLogout }: { onLogout: () => void }) {
  const [tasks, setTasks] = useState<SwarmTask[]>([]);
  const [projects, setProjects] = useState<SwarmProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [filterAssignee, setFilterAssignee] = useState<string | null>(null);
  const [filterProject, setFilterProject] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [taskResult, projectResult] = await Promise.all([
        api.listTasks({ includeCompleted: showCompleted }),
        api.listProjects(),
      ]);
      setTasks(taskResult.tasks || []);
      setProjects(projectResult.projects || []);
    } catch (err) {
      console.error("Failed to fetch swarm data:", err);
    } finally {
      setLoading(false);
    }
  }, [showCompleted]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleStatusChange = async (taskId: string, newStatus: string) => {
    try {
      await api.updateTaskStatus(taskId, newStatus);
      fetchData();
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  };

  // Filter tasks
  const filteredTasks = tasks.filter((t) => {
    if (filterAssignee && t.assigneeUserId !== filterAssignee) return false;
    if (filterProject && t.projectId !== filterProject) return false;
    return true;
  });

  // Get unique assignees
  const assignees = [
    ...new Set(tasks.map((t) => t.assigneeUserId).filter(Boolean)),
  ] as string[];

  // Group by status
  const groupedTasks = ALL_STATUSES.filter(
    (s) => showCompleted || s !== "complete",
  ).map((status) => ({
    status,
    tasks: filteredTasks.filter((t) => t.status === status),
  }));

  const projectMap = new Map(projects.map((p) => [p.id, p]));

  return (
    <div className="flex h-screen flex-col bg-background">
      <Nav onLogout={onLogout} />

      {/* Toolbar */}
      <div className="flex items-center justify-between border-b px-4 py-2 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New Task
          </Button>

          {/* Assignee filter */}
          <div className="flex gap-1">
            <Button
              variant={filterAssignee === null ? "secondary" : "ghost"}
              size="sm"
              className="text-xs h-7"
              onClick={() => setFilterAssignee(null)}
            >
              All
            </Button>
            {assignees.map((a) => (
              <Button
                key={a}
                variant={filterAssignee === a ? "secondary" : "ghost"}
                size="sm"
                className="text-xs h-7"
                onClick={() =>
                  setFilterAssignee(filterAssignee === a ? null : a)
                }
              >
                {a}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Project filter */}
          {projects.length > 0 && (
            <div className="flex gap-1">
              <Button
                variant={filterProject === null ? "secondary" : "ghost"}
                size="sm"
                className="text-xs h-7"
                onClick={() => setFilterProject(null)}
              >
                All projects
              </Button>
              {projects.map((p) => (
                <Button
                  key={p.id}
                  variant={filterProject === p.id ? "secondary" : "ghost"}
                  size="sm"
                  className="text-xs h-7"
                  onClick={() =>
                    setFilterProject(filterProject === p.id ? null : p.id)
                  }
                >
                  <span
                    className="h-2 w-2 rounded-full mr-1"
                    style={{ backgroundColor: p.color }}
                  />
                  {p.title}
                </Button>
              ))}
            </div>
          )}

          <Button
            variant={showCompleted ? "secondary" : "ghost"}
            size="sm"
            className="text-xs h-7"
            onClick={() => setShowCompleted(!showCompleted)}
          >
            {showCompleted ? "Hide completed" : "Show completed"}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={fetchData}
            disabled={loading}
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </div>

      {/* Task columns */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {groupedTasks.map(({ status, tasks: statusTasks }) => {
            const config = STATUS_CONFIG[status];
            if (!config) return null;
            if (statusTasks.length === 0 && status === "complete") return null;

            const StatusIcon = config.icon;

            return (
              <div key={status}>
                <div className="flex items-center gap-2 mb-2">
                  <StatusIcon className={`h-4 w-4 ${config.color}`} />
                  <h3 className="font-medium text-sm">{config.label}</h3>
                  <Badge variant="secondary" className="text-xs">
                    {statusTasks.length}
                  </Badge>
                </div>

                {statusTasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground pl-6">
                    No tasks
                  </p>
                ) : (
                  <div className="space-y-1.5 pl-6">
                    {statusTasks.map((task) => {
                      const project = task.projectId
                        ? projectMap.get(task.projectId)
                        : null;

                      return (
                        <Card
                          key={task.id}
                          className={`${config.bgColor} border-l-2`}
                          style={{
                            borderLeftColor: project?.color || "transparent",
                          }}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium">
                                  {task.title}
                                </p>
                                {task.detail && (
                                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                    {task.detail}
                                  </p>
                                )}
                                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                  {task.assigneeUserId && (
                                    <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                                      <User className="h-3 w-3" />
                                      {task.assigneeUserId}
                                    </span>
                                  )}
                                  {project && (
                                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                                      <span
                                        className="h-2 w-2 rounded-full"
                                        style={{
                                          backgroundColor: project.color,
                                        }}
                                      />
                                      {project.title}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Status actions */}
                              <div className="flex gap-1 shrink-0">
                                {status !== "in_progress" &&
                                  status !== "complete" && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 text-xs px-2"
                                      onClick={() =>
                                        handleStatusChange(
                                          task.id,
                                          "in_progress",
                                        )
                                      }
                                    >
                                      Start
                                    </Button>
                                  )}
                                {status === "in_progress" && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 text-xs px-2"
                                    onClick={() =>
                                      handleStatusChange(task.id, "review")
                                    }
                                  >
                                    Review
                                  </Button>
                                )}
                                {status !== "complete" && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 text-xs px-2"
                                    onClick={() =>
                                      handleStatusChange(task.id, "complete")
                                    }
                                  >
                                    ✓
                                  </Button>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Create task dialog */}
      <CreateTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projects={projects}
        onCreated={fetchData}
      />
    </div>
  );
}

function CreateTaskDialog({
  open,
  onOpenChange,
  projects,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: SwarmProject[];
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [projectId, setProjectId] = useState("");
  const [assignee, setAssignee] = useState("");
  const [sending, setSending] = useState(false);

  const KNOWN_USERS = ["chris", "clio", "domingo", "zumie"];

  const reset = () => {
    setTitle("");
    setDetail("");
    setProjectId("");
    setAssignee("");
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setSending(true);
    try {
      await api.createTask({
        title: title.trim(),
        detail: detail.trim() || undefined,
        projectId: projectId || undefined,
        assigneeUserId: assignee || undefined,
      });
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err) {
      console.error("Failed to create task:", err);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleCreate} className="space-y-4">
          <Input
            placeholder="Task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus
          />
          <Textarea
            placeholder="Details (optional)"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={3}
          />
          <div className="flex gap-2">
            <select
              className="flex-1 rounded-md border bg-transparent px-3 py-2 text-sm"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            <select
              className="flex-1 rounded-md border bg-transparent px-3 py-2 text-sm"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="">Unassigned</option>
              {KNOWN_USERS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={sending || !title.trim()}>
              {sending ? "Creating..." : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
