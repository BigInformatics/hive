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
  Eye,
  FileCode,
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
  DialogFooter,
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


interface FlowDocument {
  name?: string;
  title?: string;
  version?: string;
  description?: string;
  steps?: Array<{
    id: string;
    title: string;
    role?: string;
    description?: string;
    next?: string | null;
  }>;
  nodes?: Array<{
    id: string;
    data: {
      kind: string;
      title: string;
    };
    context?: {
      description?: string;
      finalRequirements?: string;
      disposition?: string[];
    };
  }>;
  metadata?: {
    author?: string;
    status?: string;
    version?: string;
    updatedAt?: string;
  };
}

function FlowDocumentView({ doc }: { doc: FlowDocument }) {
  const steps = doc.steps || [];
  const nodes = doc.nodes || [];
  
  // Use nodes if available (full Cambigo schema), otherwise steps
  const hasNodes = nodes.length > 0;
  const items = hasNodes ? nodes.filter(n => n.data.kind !== 'start') : steps;
  
  return (
    <div className="space-y-4">
      {doc.name || doc.title ? (
        <div>
          <h4 className="font-medium text-sm">{doc.name || doc.title}</h4>
          {doc.version && <span className="text-xs text-muted-foreground ml-2">v{doc.version}</span>}
          {doc.metadata?.author && <span className="text-xs text-muted-foreground ml-2">by {doc.metadata.author}</span>}
        </div>
      ) : null}
      {doc.description && (
        <p className="text-sm text-muted-foreground">{doc.description}</p>
      )}
      {items.length > 0 ? (
        <div className="space-y-2">
          <h5 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {hasNodes ? 'Flow Steps' : 'Steps'}
          </h5>
          <ol className="space-y-2">
            {items.map((item, i) => {
              const title = hasNodes ? (item as any).data?.title : (item as any).title;
              const kind = hasNodes ? (item as any).data?.kind : 'step';
              const description = hasNodes ? (item as any).context?.description : (item as any).description;
              const requirements = hasNodes ? (item as any).context?.finalRequirements : null;
              const role = hasNodes ? null : (item as any).role;
              
              return (
                <li key={(item as any).id || i} className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-medium">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{title}</span>
                      {kind && kind !== 'step' && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">
                          {kind}
                        </Badge>
                      )}
                      {role && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {role}
                        </Badge>
                      )}
                    </div>
                    {description && (
                      <p className="text-xs text-muted-foreground">{description}</p>
                    )}
                    {requirements && (
                      <p className="text-xs text-muted-foreground italic">Requirements: {requirements.slice(0, 150)}{requirements.length > 150 ? '...' : ''}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ) : (
        <pre className="p-3 bg-muted rounded-md overflow-x-auto text-xs max-h-64">
          {JSON.stringify(doc, null, 2)}
        </pre>
      )}
    </div>
  );
}

function WorkflowCard({
  wf,
  onEdit,
  onToggle,
  onDelete,
  onView,
  onPreviewLobster,
}: {
  wf: Workflow;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onView?: () => void;
  onPreviewLobster?: () => void;
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
              onClick={() => onView?.()}
              title="View document"
            >
              <Eye className="h-3.5 w-3.5" />
            </Button>
            {(wf.document || wf.documentUrl) && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => onPreviewLobster?.()}
                title="Export as Lobster"
              >
                <FileCode className="h-3.5 w-3.5" />
              </Button>
            )}
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
  const [viewing, setViewing] = useState<Workflow | null>(null);
  const [lobsterPreview, setLobsterPreview] = useState<{
    wf: Workflow;
    content: string;
  } | null>(null);
  const [lobsterLoading, setLobsterLoading] = useState(false);

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

  const handlePreviewLobster = async (wf: Workflow) => {
    setLobsterLoading(true);
    try {
      const token =
        typeof window !== "undefined"
          ? (localStorage.getItem("hive-key") ?? "")
          : "";
      const res = await fetch(`/api/swarm/workflows/${wf.id}/lobster`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const text = await res.text();
      setLobsterPreview({ wf, content: text });
    } catch (err) {
      console.error("Failed to fetch lobster export:", err);
    } finally {
      setLobsterLoading(false);
    }
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
              onView={() => setViewing(wf)}
              onPreviewLobster={() => handlePreviewLobster(wf)}
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

      {/* View dialog */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewing?.title}</DialogTitle>
          </DialogHeader>
          {viewing?.document ? (
            <div className="space-y-4">
              {viewing.description && (
                <p className="text-sm text-muted-foreground">{viewing.description}</p>
              )}
              <FlowDocumentView doc={viewing.document as FlowDocument} />
            </div>
          ) : viewing?.documentUrl ? (
            <div className="space-y-4">
              {viewing.description && (
                <p className="text-sm text-muted-foreground">{viewing.description}</p>
              )}
              <div className="flex items-center gap-2">
                <a
                  href={viewing.documentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline flex items-center gap-1"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open in Cambigo
                </a>
              </div>
              <p className="text-xs text-muted-foreground">
                Document is loaded from URL. Open in Cambigo to view and edit.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No document loaded.</p>
          )}
          {viewing && (
            <div className="mt-4 pt-4 border-t text-xs text-muted-foreground space-y-1">
              <div><strong>ID:</strong> <code className="bg-muted px-1 rounded">{viewing.id}</code></div>
              <div><strong>Created by:</strong> {viewing.createdBy}</div>
              <div><strong>Created:</strong> {new Date(viewing.createdAt).toLocaleString()}</div>
              {viewing.expiresAt && <div><strong>Expires:</strong> {new Date(viewing.expiresAt).toLocaleString()}</div>}
              {viewing.reviewAt && <div><strong>Review by:</strong> {new Date(viewing.reviewAt).toLocaleString()}</div>}
              {viewing.taggedUsers && viewing.taggedUsers.length > 0 && (
                <div><strong>Visible to:</strong> {viewing.taggedUsers.join(", ")}</div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Lobster export preview */}
      <Dialog
        open={!!lobsterPreview}
        onOpenChange={(o) => !o && setLobsterPreview(null)}
      >
        <DialogContent className="sm:max-w-2xl w-full flex flex-col max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCode className="h-4 w-4" />
              {lobsterPreview?.wf.title} — Lobster Export
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto min-h-0">
            {lobsterLoading ? (
              <p className="text-sm text-muted-foreground p-4">Loading…</p>
            ) : (
              <pre className="rounded-md bg-muted/40 border p-4 text-xs font-mono whitespace-pre overflow-x-auto">
                {lobsterPreview?.content}
              </pre>
            )}
          </div>
          <DialogFooter className="shrink-0 pt-2 border-t gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (lobsterPreview?.content) {
                  navigator.clipboard.writeText(lobsterPreview.content);
                }
              }}
            >
              Copy
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!lobsterPreview) return;
                const blob = new Blob([lobsterPreview.content], {
                  type: "text/plain",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${lobsterPreview.wf.title
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")}.lobster`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Download
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLobsterPreview(null)}
            >
              Close
            </Button>
          </DialogFooter>
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
