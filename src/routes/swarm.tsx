import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { getMailboxKey, api } from "@/lib/api";
import { useSwarmSSE } from "@/lib/use-swarm-sse";
import { LoginGate } from "@/components/login-gate";
import { Nav } from "@/components/nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  Plus,
  Circle,
  CheckCircle2,
  Clock,
  Pause,
  Eye,
  PlayCircle,
  User,
  GripVertical,
  Columns3,
  List,
  Globe,
  GitBranch,
  Github,
  Crown,
  Code,
  ExternalLink,
} from "lucide-react";

export const Route = createFileRoute("/swarm")({
  component: SwarmPage,
});

interface SwarmTask {
  id: string;
  projectId: string | null;
  title: string;
  detail: string | null;
  issueUrl: string | null;
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
  websiteUrl?: string | null;
  onedevUrl?: string | null;
  githubUrl?: string | null;
  projectLeadUserId?: string | null;
  developerLeadUserId?: string | null;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; icon: typeof Circle; color: string; bgColor: string; borderColor: string }
> = {
  queued: {
    label: "Queued",
    icon: Circle,
    color: "text-muted-foreground",
    bgColor: "bg-muted/30",
    borderColor: "border-muted-foreground/30",
  },
  ready: {
    label: "Ready",
    icon: PlayCircle,
    color: "text-green-500",
    bgColor: "bg-green-500/5",
    borderColor: "border-green-500/30",
  },
  in_progress: {
    label: "In Progress",
    icon: Clock,
    color: "text-sky-500",
    bgColor: "bg-sky-500/5",
    borderColor: "border-sky-500/30",
  },
  holding: {
    label: "Holding",
    icon: Pause,
    color: "text-amber-500",
    bgColor: "bg-amber-500/5",
    borderColor: "border-amber-500/30",
  },
  review: {
    label: "Review",
    icon: Eye,
    color: "text-purple-500",
    bgColor: "bg-purple-500/5",
    borderColor: "border-purple-500/30",
  },
  complete: {
    label: "Complete",
    icon: CheckCircle2,
    color: "text-green-500",
    bgColor: "bg-green-500/5",
    borderColor: "border-green-500/30",
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

const KNOWN_USERS = ["chris", "clio", "domingo", "zumie"];

const AVATARS: Record<string, string> = {
  chris: "/avatars/chris.jpg",
  clio: "/avatars/clio.png",
  domingo: "/avatars/domingo.jpg",
  zumie: "/avatars/zumie.png",
};

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
  const [viewMode, setViewMode] = useState<"board" | "list">("board");
  const [createOpen, setCreateOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [editTask, setEditTask] = useState<SwarmTask | null>(null);
  const [filterAssignee, setFilterAssignee] = useState<string | null>(null);
  const [filterProject, setFilterProject] = useState<string | null>(null);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

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

  // Live updates via SSE
  useSwarmSSE(useCallback(() => {
    fetchData();
  }, [fetchData]));

  const handleStatusChange = async (taskId: string, newStatus: string) => {
    // Optimistic update
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, status: newStatus, completedAt: newStatus === "complete" ? new Date().toISOString() : t.completedAt }
          : t
      )
    );
    try {
      await api.updateTaskStatus(taskId, newStatus);
    } catch (err) {
      console.error("Failed to update status:", err);
      fetchData(); // revert on error
    }
  };

  const handleDrop = (status: string) => {
    if (dragTaskId && dragTaskId !== status) {
      handleStatusChange(dragTaskId, status);
    }
    setDragTaskId(null);
    setDropTarget(null);
  };

  // Filter tasks
  const filteredTasks = tasks.filter((t) => {
    if (filterAssignee && t.assigneeUserId !== filterAssignee) return false;
    if (filterProject && t.projectId !== filterProject) return false;
    return true;
  });

  const assignees = [
    ...new Set(tasks.map((t) => t.assigneeUserId).filter(Boolean)),
  ] as string[];

  const visibleStatuses = ALL_STATUSES.filter(
    (s) => showCompleted || s !== "complete"
  );

  const groupedTasks = visibleStatuses.map((status) => ({
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
            <Plus className="h-3.5 w-3.5 mr-1" /> Task
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCreateProjectOpen(true)}
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Project
          </Button>

          <div className="h-4 w-px bg-border mx-1" />

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
                className="text-xs h-7 gap-1"
                onClick={() =>
                  setFilterAssignee(filterAssignee === a ? null : a)
                }
              >
                {AVATARS[a] ? (
                  <img src={AVATARS[a]} alt={a} className="h-4 w-4 rounded-full" />
                ) : null}
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

          <div className="h-4 w-px bg-border mx-1" />

          <Button
            variant={showCompleted ? "secondary" : "ghost"}
            size="sm"
            className="text-xs h-7"
            onClick={() => setShowCompleted(!showCompleted)}
          >
            {showCompleted ? "Hide done" : "Show done"}
          </Button>

          {/* View toggle */}
          <div className="flex border rounded-md">
            <Button
              variant={viewMode === "board" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 rounded-r-none"
              onClick={() => setViewMode("board")}
            >
              <Columns3 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 rounded-l-none"
              onClick={() => setViewMode("list")}
            >
              <List className="h-3.5 w-3.5" />
            </Button>
          </div>

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

      {/* Board or List */}
      {viewMode === "board" ? (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex h-full gap-3 p-4" style={{ minWidth: `${visibleStatuses.length * 280}px` }}>
            {groupedTasks.map(({ status, tasks: statusTasks }) => {
              const config = STATUS_CONFIG[status];
              if (!config) return null;
              const StatusIcon = config.icon;
              const isDropping = dropTarget === status && dragTaskId !== null;

              return (
                <div
                  key={status}
                  className={`flex flex-col w-[260px] shrink-0 rounded-lg border ${config.borderColor} ${isDropping ? "ring-2 ring-primary/50" : ""} transition-shadow`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDropTarget(status);
                  }}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDrop(status);
                  }}
                >
                  {/* Column header */}
                  <div className={`flex items-center gap-2 px-3 py-2 border-b ${config.borderColor} ${config.bgColor} rounded-t-lg`}>
                    <StatusIcon className={`h-4 w-4 ${config.color}`} />
                    <span className="font-medium text-sm">{config.label}</span>
                    <Badge variant="secondary" className="text-xs ml-auto">
                      {statusTasks.length}
                    </Badge>
                  </div>

                  {/* Cards */}
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {statusTasks.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-8">
                        {isDropping ? "Drop here" : "No tasks"}
                      </p>
                    ) : (
                      statusTasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          project={task.projectId ? projectMap.get(task.projectId) : undefined}
                          onDragStart={() => setDragTaskId(task.id)}
                          onDragEnd={() => { setDragTaskId(null); setDropTarget(null); }}
                          isDragging={dragTaskId === task.id}
                          onStatusChange={handleStatusChange}
                          onClick={() => setEditTask(task)}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <ListView
          groupedTasks={groupedTasks}
          projectMap={projectMap}
          onStatusChange={handleStatusChange}
          onTaskClick={(t) => setEditTask(t)}
        />
      )}

      <CreateTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projects={projects}
        onCreated={fetchData}
      />

      <CreateProjectDialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
        onCreated={fetchData}
      />

      <TaskDetailDialog
        task={editTask}
        project={editTask?.projectId ? projectMap.get(editTask.projectId) : undefined}
        projects={projects}
        onClose={() => setEditTask(null)}
        onUpdated={fetchData}
        onStatusChange={handleStatusChange}
      />
    </div>
  );
}

/* ─── Task Card ─── */

function TaskCard({
  task,
  project,
  onDragStart,
  onDragEnd,
  isDragging,
  onStatusChange,
  onClick,
}: {
  task: SwarmTask;
  project?: SwarmProject;
  onDragStart: () => void;
  onDragEnd: () => void;
  isDragging: boolean;
  onStatusChange: (id: string, status: string) => void;
  onClick: () => void;
}) {
  return (
    <Card
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`cursor-grab active:cursor-grabbing transition-opacity ${isDragging ? "opacity-40" : ""} hover:shadow-md`}
      onClick={onClick}
    >
      <CardContent className="p-3">
        {/* Project indicator */}
        {project && (
          <div className="flex items-center gap-1.5 mb-1.5">
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: project.color }}
            />
            <span className="text-[11px] text-muted-foreground truncate">
              {project.title}
            </span>
          </div>
        )}

        <p className="text-sm font-medium leading-snug">{task.title}</p>

        {task.issueUrl && (
          <a
            href={task.issueUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-sky-500 hover:underline truncate block mt-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            {task.issueUrl.replace(/^https?:\/\//, "").slice(0, 50)}
          </a>
        )}

        {task.detail && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {task.detail}
          </p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-1.5">
            {task.assigneeUserId && (
              AVATARS[task.assigneeUserId] ? (
                <img
                  src={AVATARS[task.assigneeUserId]}
                  alt={task.assigneeUserId}
                  className="h-5 w-5 rounded-full"
                  title={task.assigneeUserId}
                />
              ) : (
                <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                  <User className="h-3 w-3" />
                  {task.assigneeUserId}
                </span>
              )
            )}
          </div>

          {/* Quick actions */}
          <div className="flex gap-0.5" onClick={(e) => e.stopPropagation()}>
            {task.status !== "complete" && task.status !== "in_progress" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] px-1.5 text-muted-foreground hover:text-foreground"
                onClick={() => onStatusChange(task.id, "in_progress")}
              >
                Start
              </Button>
            )}
            {task.status === "in_progress" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] px-1.5 text-muted-foreground hover:text-foreground"
                onClick={() => onStatusChange(task.id, "review")}
              >
                Review
              </Button>
            )}
            {task.status !== "complete" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] px-1.5 text-muted-foreground hover:text-foreground"
                onClick={() => onStatusChange(task.id, "complete")}
              >
                ✓
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── List View (preserved from original) ─── */

function ListView({
  groupedTasks,
  projectMap,
  onStatusChange,
  onTaskClick,
}: {
  groupedTasks: { status: string; tasks: SwarmTask[] }[];
  projectMap: Map<string, SwarmProject>;
  onStatusChange: (id: string, status: string) => void;
  onTaskClick: (task: SwarmTask) => void;
}) {
  return (
    <div className="flex-1 overflow-auto p-4 space-y-6">
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
              <p className="text-xs text-muted-foreground pl-6">No tasks</p>
            ) : (
              <div className="space-y-1.5 pl-6">
                {statusTasks.map((task) => {
                  const project = task.projectId
                    ? projectMap.get(task.projectId)
                    : null;

                  return (
                    <Card
                      key={task.id}
                      className={`${config.bgColor} border-l-2 cursor-pointer hover:shadow-sm transition-shadow`}
                      style={{
                        borderLeftColor: project?.color || "transparent",
                      }}
                      onClick={() => onTaskClick(task)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{task.title}</p>
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
                                    style={{ backgroundColor: project.color }}
                                  />
                                  {project.title}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                            {status !== "in_progress" && status !== "complete" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs px-2"
                                onClick={() => onStatusChange(task.id, "in_progress")}
                              >
                                Start
                              </Button>
                            )}
                            {status === "in_progress" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs px-2"
                                onClick={() => onStatusChange(task.id, "review")}
                              >
                                Review
                              </Button>
                            )}
                            {status !== "complete" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs px-2"
                                onClick={() => onStatusChange(task.id, "complete")}
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
  );
}

/* ─── Task Detail Dialog ─── */

function TaskDetailDialog({
  task,
  project,
  projects,
  onClose,
  onUpdated,
  onStatusChange,
}: {
  task: SwarmTask | null;
  project?: SwarmProject;
  projects: SwarmProject[];
  onClose: () => void;
  onUpdated: () => void;
  onStatusChange: (id: string, status: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [issueUrl, setIssueUrl] = useState("");
  const [assignee, setAssignee] = useState("");
  const [projectId, setProjectId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDetail(task.detail || "");
      setIssueUrl(task.issueUrl || "");
      setAssignee(task.assigneeUserId || "");
      setProjectId(task.projectId || "");
      setEditing(false);
    }
  }, [task]);

  if (!task) return null;

  const config = STATUS_CONFIG[task.status];

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateTask(task.id, {
        title: title.trim(),
        detail: detail.trim() || null,
        issueUrl: issueUrl.trim() || null,
        assigneeUserId: assignee || null,
        projectId: projectId || null,
      });
      setEditing(false);
      onUpdated();
      onClose();
    } catch (err) {
      console.error("Failed to update task:", err);
    } finally {
      setSaving(false);
    }
  };

  const StatusIcon = config?.icon || Circle;

  return (
    <Dialog open={!!task} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <StatusIcon className={`h-4 w-4 ${config?.color}`} />
            {editing ? "Edit Task" : task.title}
          </DialogTitle>
        </DialogHeader>

        {editing ? (
          <div className="space-y-4">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
            />
            <Textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="Details"
              rows={4}
            />
            <Input
              value={issueUrl}
              onChange={(e) => setIssueUrl(e.target.value)}
              placeholder="Issue URL (optional)"
              type="url"
            />
            <div className="flex gap-2">
              <select
                className="flex-1 rounded-md border bg-transparent px-3 py-2 text-sm"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
              <select
                className="flex-1 rounded-md border bg-transparent px-3 py-2 text-sm"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              >
                <option value="">Unassigned</option>
                {KNOWN_USERS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !title.trim()}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Meta */}
            <div className="flex flex-wrap gap-2">
              {project && (
                <Badge variant="outline" className="gap-1">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: project.color }} />
                  {project.title}
                </Badge>
              )}
              {task.assigneeUserId && (
                <Badge variant="outline" className="gap-1">
                  {AVATARS[task.assigneeUserId] ? (
                    <img src={AVATARS[task.assigneeUserId]} alt="" className="h-3 w-3 rounded-full" />
                  ) : (
                    <User className="h-3 w-3" />
                  )}
                  {task.assigneeUserId}
                </Badge>
              )}
              <Badge variant="secondary" className={config?.color}>
                {config?.label || task.status}
              </Badge>
            </div>

            {/* Issue URL */}
            {task.issueUrl && (
              <a
                href={task.issueUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-sky-500 hover:underline block"
              >
                🔗 {task.issueUrl.replace(/^https?:\/\//, "").slice(0, 60)}
              </a>
            )}

            {/* Detail */}
            {task.detail ? (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.detail}</p>
            ) : (
              <p className="text-sm text-muted-foreground italic">No details</p>
            )}

            {/* Status actions */}
            <div className="flex flex-wrap gap-2">
              {ALL_STATUSES.filter((s) => s !== task.status).map((s) => {
                const sc = STATUS_CONFIG[s];
                if (!sc) return null;
                const Icon = sc.icon;
                return (
                  <Button
                    key={s}
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => {
                      onStatusChange(task.id, s);
                      onClose();
                    }}
                  >
                    <Icon className={`h-3 w-3 ${sc.color}`} />
                    {sc.label}
                  </Button>
                );
              })}
            </div>

            {/* Project leads */}
            {project && (project.projectLeadUserId || project.developerLeadUserId) && (
              <div className="flex gap-4 text-xs text-muted-foreground pt-2 border-t">
                {project.projectLeadUserId && (
                  <span className="flex items-center gap-1">
                    <Crown className="h-3 w-3" /> Lead: <strong>{project.projectLeadUserId}</strong>
                  </span>
                )}
                {project.developerLeadUserId && (
                  <span className="flex items-center gap-1">
                    <Code className="h-3 w-3" /> Dev: <strong>{project.developerLeadUserId}</strong>
                  </span>
                )}
              </div>
            )}

            {/* Timestamps */}
            <div className="text-xs text-muted-foreground space-y-0.5 pt-2 border-t">
              <p>Created: {new Date(task.createdAt).toLocaleString()}</p>
              <p>Updated: {new Date(task.updatedAt).toLocaleString()}</p>
              {task.completedAt && (
                <p>Completed: {new Date(task.completedAt).toLocaleString()}</p>
              )}
            </div>

            {/* Project links */}
            {project && (project.websiteUrl || project.onedevUrl || project.githubUrl) && (
              <div className="flex gap-2 pt-2 border-t">
                {project.websiteUrl && (
                  <a href={project.websiteUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                    <Globe className="h-3.5 w-3.5" />
                  </a>
                )}
                {project.onedevUrl && (
                  <a href={project.onedevUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                    <GitBranch className="h-3.5 w-3.5" />
                  </a>
                )}
                {project.githubUrl && (
                  <a href={project.githubUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                    <Github className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            )}

            {/* Edit button */}
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ─── Create Task Dialog ─── */

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
  const [issueUrl, setIssueUrl] = useState("");
  const [projectId, setProjectId] = useState("");
  const [assignee, setAssignee] = useState("");
  const [sending, setSending] = useState(false);

  const reset = () => {
    setTitle("");
    setDetail("");
    setIssueUrl("");
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
        issueUrl: issueUrl.trim() || undefined,
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
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
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
          <Input
            placeholder="Issue URL (optional)"
            value={issueUrl}
            onChange={(e) => setIssueUrl(e.target.value)}
            type="url"
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

/* ─── Create Project Dialog ─── */

const PROJECT_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4",
  "#3b82f6", "#8b5cf6", "#ec4899", "#6366f1", "#14b8a6",
];

function CreateProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [lead, setLead] = useState("");
  const [devLead, setDevLead] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [onedevUrl, setOnedevUrl] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [sending, setSending] = useState(false);

  const reset = () => {
    setTitle("");
    setDescription("");
    setColor(PROJECT_COLORS[0]);
    setLead("");
    setDevLead("");
    setWebsiteUrl("");
    setOnedevUrl("");
    setGithubUrl("");
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setSending(true);
    try {
      await api.createProject({
        title: title.trim(),
        color,
        description: description.trim() || undefined,
        projectLeadUserId: lead || undefined,
        developerLeadUserId: devLead || undefined,
        websiteUrl: websiteUrl.trim() || undefined,
        onedevUrl: onedevUrl.trim() || undefined,
        githubUrl: githubUrl.trim() || undefined,
      });
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err) {
      console.error("Failed to create project:", err);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleCreate} className="space-y-4">
          <Input
            placeholder="Project name"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus
          />
          <Textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />

          <div>
            <p className="text-xs text-muted-foreground mb-2">Color</p>
            <div className="flex gap-2 flex-wrap">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`h-8 w-8 rounded-full transition-transform ${
                    color === c ? "ring-2 ring-offset-2 ring-primary scale-110" : ""
                  }`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <p className="text-xs text-muted-foreground mb-1">Project Lead</p>
              <select
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                value={lead}
                onChange={(e) => setLead(e.target.value)}
              >
                <option value="">Select...</option>
                {KNOWN_USERS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <p className="text-xs text-muted-foreground mb-1">Dev Lead</p>
              <select
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                value={devLead}
                onChange={(e) => setDevLead(e.target.value)}
              >
                <option value="">Select...</option>
                {KNOWN_USERS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Links (optional)</p>
            <Input
              placeholder="Website URL"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
            />
            <Input
              placeholder="OneDev URL"
              value={onedevUrl}
              onChange={(e) => setOnedevUrl(e.target.value)}
            />
            <Input
              placeholder="GitHub URL"
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
            />
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
              {sending ? "Creating..." : "Create Project"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
