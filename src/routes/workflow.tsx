import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  Upload,
  Check,
  Clock,
  Copy, ExternalLink,
  GitBranch,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Trash2,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { LoginGate } from "@/components/login-gate";
import { Nav } from "@/components/nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UserSelect } from "@/components/user-select";
import { api, getMailboxKey } from "@/lib/api";

export const Route = createFileRoute("/workflow")({
  component: WorkflowPage,
});

interface Workflow {
  id: string;
  title: string;
  description: string | null;
  documentUrl: string | null;
  document: unknown;
  enabled: boolean;
  taggedUsers: string[] | null;
  expiresAt: string | null;
  reviewAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function toLocalDatetimeValue(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function WorkflowCard({
  wf,
  onEdit,
  onToggle,
  onDelete,
}: {
  wf: Workflow;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const expired = wf.expiresAt && new Date(wf.expiresAt) < new Date();
  const needsReview =
    wf.reviewAt && new Date(wf.reviewAt) < new Date() && !expired;

  return (
    <Card className={`transition-opacity ${!wf.enabled ? "opacity-60" : ""}`}>
      <CardContent className="p-4 space-y-2">
        {/* Banners */}
        {expired && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Expired {formatDate(wf.expiresAt)} — this workflow should not be
            used.
          </div>
        )}
        {needsReview && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            Past review date ({formatDate(wf.reviewAt)}) — may need updating.
          </div>
        )}

        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-medium text-sm leading-snug truncate">
                {wf.title}
              </h3>
              {!wf.enabled && (
                <Badge variant="secondary" className="text-[10px] px-1.5">
                  Disabled
                </Badge>
              )}
              {expired && (
                <Badge variant="destructive" className="text-[10px] px-1.5">
                  Expired
                </Badge>
              )}
              {needsReview && (
                <Badge className="text-[10px] px-1.5 bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40">
                  Needs Review
                </Badge>
              )}
            </div>
            {wf.description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                {wf.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {wf.documentUrl && (
              <a
                href={wf.documentUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Open document"
              >
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </a>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                navigator.clipboard.writeText(`workflow:${wf.id}`);
                // Could add a toast here
              }}
              title="Copy workflow ID"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onEdit}
              title="Edit"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onToggle}
              title={wf.enabled ? "Disable" : "Enable"}
            >
              {wf.enabled ? (
                <PowerOff className="h-3.5 w-3.5" />
              ) : (
                <Power className="h-3.5 w-3.5 text-green-600" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={onDelete}
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
          {wf.taggedUsers && wf.taggedUsers.length > 0 && (
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {wf.taggedUsers.join(", ")}
            </span>
          )}
          {wf.expiresAt && !expired && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Expires {formatDate(wf.expiresAt)}
            </span>
          )}
          {wf.reviewAt && !needsReview && (
            <span className="flex items-center gap-1">
              <Check className="h-3 w-3" />
              Review by {formatDate(wf.reviewAt)}
            </span>
          )}
          <span className="ml-auto">by {wf.createdBy}</span>
        </div>
      </CardContent>
    </Card>
  );
}

const EMPTY_FORM = {
  title: "",
  description: "",
  documentUrl: "",
  enabled: true,
  taggedUsers: [] as string[],
  document: null as unknown,
  expiresAt: "",
  reviewAt: "",
};

function WorkflowForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: Partial<typeof EMPTY_FORM & { id: string }>;
  onSave: (data: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    ...EMPTY_FORM,
    ...initial,
    taggedUsers: initial?.taggedUsers ?? [],
    document: (initial as any)?.document ?? null,
  });

  const set = (k: keyof typeof EMPTY_FORM, v: string | boolean | unknown) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    await onSave({
      title: form.title,
      description: form.description || null,
      documentUrl: form.documentUrl || null,
      document: form.document || undefined,
      enabled: form.enabled,
      taggedUsers: form.taggedUsers.length ? form.taggedUsers : null,
      expiresAt: form.expiresAt || null,
      reviewAt: form.reviewAt || null,
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-medium text-muted-foreground">
          Title *
        </label>
        <Input
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="Workflow name"
          className="mt-1"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground">
          Description
        </label>
        <Textarea
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="What this workflow is for..."
          className="mt-1 min-h-[60px]"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground">
          Document URL
        </label>
        <Input
          value={form.documentUrl}
          onChange={(e) => set("documentUrl", e.target.value)}
          placeholder="https://raw.githubusercontent.com/..."
          className="mt-1"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground">
          Or upload a flow JSON file
        </label>
        <Input
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              const reader = new FileReader();
              reader.onload = (ev) => {
                try {
                  const json = JSON.parse(ev.target?.result as string);
                  // Extract title/description from Cambigo flow document
                  const updates: Partial<typeof form> = { document: json, documentUrl: "" };
                  if (json.title && typeof json.title === "string") {
                    updates.title = json.title;
                  }
                  if (json.description && typeof json.description === "string") {
                    updates.description = json.description;
                  }
                  setForm((f: typeof form) => ({ ...f, ...updates }));
                } catch {
                  alert("Invalid JSON file");
                }
              };
              reader.readAsText(file);
            }
          }}
          className="mt-1"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground">
          Access
        </label>
        <UserSelect
          value={form.taggedUsers}
          onChange={(users: string[]) => setForm((f: typeof form) => ({ ...f, taggedUsers: users }))}
          className="mt-1"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Expires At
          </label>
          <Input
            type="datetime-local"
            value={form.expiresAt}
            onChange={(e) => set("expiresAt", e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Review By
          </label>
          <Input
            type="datetime-local"
            value={form.reviewAt}
            onChange={(e) => set("reviewAt", e.target.value)}
            className="mt-1"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="enabled-chk"
          checked={form.enabled}
          onChange={(e) => set("enabled", e.target.checked)}
        />
        <label htmlFor="enabled-chk" className="text-sm">
          Enabled
        </label>
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={saving || !form.title}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function WorkflowPageContent() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDisabled, setShowDisabled] = useState(false);
  const [editing, setEditing] = useState<Workflow | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Workflow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await (api as any).listWorkflows(showDisabled);
      setWorkflows(data.workflows ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [showDisabled]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (data: Record<string, unknown>) => {
    setSaving(true);
    try {
      await (api as any).createWorkflow(data);
      setCreating(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (data: Record<string, unknown>) => {
    if (!editing) return;
    setSaving(true);
    try {
      await (api as any).updateWorkflow(editing.id, data);
      setEditing(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (wf: Workflow) => {
    await (api as any).updateWorkflow(wf.id, { enabled: !wf.enabled });
    await load();
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    await (api as any).deleteWorkflow(confirmDelete.id);
    setConfirmDelete(null);
    await load();
  };

  return (
    <div className="w-[90vw] max-w-[90vw] mx-auto px-4 py-6 pb-24 md:pb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <GitBranch className="h-4 w-4" /> Workflows
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Step-by-step procedures for agents and team members
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDisabled((v) => !v)}
          >
            {showDisabled ? "Hide disabled" : "Show disabled"}
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New
          </Button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : workflows.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No workflows yet.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => setCreating(true)}
          >
            Create one
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {workflows.map((wf) => (
            <WorkflowCard
              key={wf.id}
              wf={wf}
              onEdit={() => setEditing(wf)}
              onToggle={() => handleToggle(wf)}
              onDelete={() => setConfirmDelete(wf)}
            />
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={creating} onOpenChange={(o) => !o && setCreating(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Workflow</DialogTitle>
          </DialogHeader>
          <WorkflowForm
            onSave={handleCreate}
            onCancel={() => setCreating(false)}
            saving={saving}
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Workflow</DialogTitle>
          </DialogHeader>
          {editing && (
            <WorkflowForm
              initial={{
                ...editing,
                taggedUsers: editing.taggedUsers ?? [],
                expiresAt: toLocalDatetimeValue(editing.expiresAt),
                reviewAt: toLocalDatetimeValue(editing.reviewAt),
              }}
              onSave={handleUpdate}
              onCancel={() => setEditing(null)}
              saving={saving}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Workflow</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Delete{" "}
            <strong className="text-foreground">{confirmDelete?.title}</strong>?
            This will detach it from all tasks.
          </p>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WorkflowPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  
  useEffect(() => {
    setLoggedIn(!!getMailboxKey());
  }, []);
  
  if (!loggedIn) {
    return <LoginGate onLogin={() => setLoggedIn(true)} />;
  }
  return (
    <div className="min-h-screen bg-background">
      <Nav onLogout={() => setLoggedIn(false)} />
      <WorkflowPageContent />
    </div>
  );
}
