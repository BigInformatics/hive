import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { getMailboxKey, api } from "@/lib/api";
import { LoginGate } from "@/components/login-gate";
import { Nav } from "@/components/nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  BookOpen,
  Plus,
  ArrowLeft,
  Eye,
  Code2,
  Lock,
  Unlock,
  Trash2,
} from "lucide-react";
import { UserSelect } from "@/components/user-select";
import { marked } from "marked";
import DOMPurify from "dompurify";

export const Route = createFileRoute("/notebook")({
  component: NotebookPage,
});

interface PageSummary {
  id: string;
  title: string;
  createdBy: string;
  taggedUsers: string[] | null;
  locked: boolean;
  lockedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface FullPage extends PageSummary {
  content: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function NotebookPage() {
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    setAuthed(!!getMailboxKey());
  }, []);
  if (!authed) return <LoginGate onLogin={() => setAuthed(true)} />;
  return <NotebookContent />;
}

function NotebookContent() {
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);

  if (selectedPageId) {
    return (
      <PageEditor
        pageId={selectedPageId}
        onBack={() => setSelectedPageId(null)}
      />
    );
  }

  return <PageList onSelect={setSelectedPageId} />;
}

// ─── Page List ────────────────────────────────────────────────────────────────

function PageList({ onSelect }: { onSelect: (id: string) => void }) {
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newTagged, setNewTagged] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listNotebookPages(q || undefined);
      setPages(Array.isArray(data.pages) ? data.pages : []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load pages");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => load(search), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [search, load]);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const data = await api.createNotebookPage({
        title: newTitle.trim(),
        taggedUsers: newTagged.length > 0 ? newTagged : undefined,
      });
      setDialogOpen(false);
      setNewTitle("");
      setNewTagged([]);
      onSelect(data.page.id);
    } catch (e: any) {
      alert(e?.message ?? "Failed to create page");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background pb-14 md:pb-0">
      <Nav onLogout={() => window.location.reload()} />
      <main className="container max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center gap-2 mb-5">
          <BookOpen className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Notebook</h1>
        </div>

        <div className="flex items-center gap-3 mb-5">
          <Input
            placeholder="Search pages…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1"
          />
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                New
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>New Page</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="nb-title">Title *</Label>
                  <Input
                    id="nb-title"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Page title"
                    onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Visible to</Label>
                  <UserSelect
                    value={newTagged}
                    onChange={setNewTagged}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={creating || !newTitle.trim()}
                >
                  {creating ? "Creating…" : "Create Page"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <p className="text-center text-muted-foreground text-sm py-16">
            Loading…
          </p>
        ) : error ? (
          <p className="text-center text-destructive text-sm py-16">
            {error}
          </p>
        ) : pages.length === 0 ? (
          <p className="text-center text-muted-foreground text-sm py-16">
            {search
              ? "No pages match your search."
              : "No pages yet — create the first one!"}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {pages.map((page) => (
              <Card
                key={page.id}
                className="cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => onSelect(page.id)}
              >
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="font-medium truncate">
                          {page.title}
                        </span>
                        {page.locked && (
                          <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground">
                          {page.createdBy} · {formatDate(page.updatedAt)}
                        </span>
                        {page.taggedUsers &&
                          page.taggedUsers.length > 0 && (
                            <span className="flex gap-1 flex-wrap">
                              {page.taggedUsers.map((u) => (
                                <Badge
                                  key={u}
                                  variant="secondary"
                                  className="text-xs px-1.5 py-0 h-4"
                                >
                                  {u}
                                </Badge>
                              ))}
                            </span>
                          )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Page Editor ──────────────────────────────────────────────────────────────

function PageEditor({
  pageId,
  onBack,
}: {
  pageId: string;
  onBack: () => void;
}) {
  const [page, setPage] = useState<FullPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<"source" | "preview">("source");
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [identity, setIdentity] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);

  // Get current user identity
  useEffect(() => {
    const key = getMailboxKey();
    if (key) {
      fetch("/api/auth/verify", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
      })
        .then((r) => r.json())
        .then((d) => setIdentity(d.identity))
        .catch(() => {});
    }
  }, []);

  // Load page
  useEffect(() => {
    setLoading(true);
    api
      .getNotebookPage(pageId)
      .then((data: any) => {
        setPage(data.page);
        setTitle(data.page.title);
        setContent(data.page.content);
        contentRef.current = data.page.content;
      })
      .catch((e: any) => setError(e?.message ?? "Failed to load page"))
      .finally(() => setLoading(false));
  }, [pageId]);

  // Auto-save content
  const scheduleContentSave = useCallback(
    (newContent: string) => {
      contentRef.current = newContent;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaving("saving");
      saveTimer.current = setTimeout(async () => {
        try {
          await api.updateNotebookPage(pageId, {
            content: contentRef.current,
          });
          setSaving("saved");
          setTimeout(() => setSaving("idle"), 2000);
        } catch {
          setSaving("idle");
        }
      }, 2000);
    },
    [pageId],
  );

  const handleContentChange = (val: string) => {
    setContent(val);
    scheduleContentSave(val);
  };

  const handleTitleSave = async () => {
    if (!title.trim() || title === page?.title) return;
    try {
      await api.updateNotebookPage(pageId, { title: title.trim() });
      setPage((p) => (p ? { ...p, title: title.trim() } : p));
    } catch {}
  };

  const handleToggleLock = async () => {
    if (!page) return;
    try {
      const data = await api.updateNotebookPage(pageId, {
        locked: !page.locked,
      });
      setPage(data.page);
    } catch (e: any) {
      alert(e?.message ?? "Failed to toggle lock");
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this page permanently?")) return;
    try {
      await api.deleteNotebookPage(pageId);
      onBack();
    } catch (e: any) {
      alert(e?.message ?? "Failed to delete");
    }
  };

  const isOwnerOrAdmin = page
    ? identity === page.createdBy || identity === "chris"
    : false;
  const isLocked = page?.locked && !isOwnerOrAdmin;

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-background pb-14 md:pb-0">
        <Nav onLogout={() => window.location.reload()} />
        <main className="container max-w-3xl mx-auto px-4 py-6">
          <p className="text-center text-muted-foreground py-16">Loading…</p>
        </main>
      </div>
    );
  }

  if (error || !page) {
    return (
      <div className="min-h-[100dvh] bg-background pb-14 md:pb-0">
        <Nav onLogout={() => window.location.reload()} />
        <main className="container max-w-3xl mx-auto px-4 py-6">
          <Button variant="ghost" size="sm" onClick={onBack} className="mb-4">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <p className="text-center text-destructive py-16">
            {error ?? "Page not found"}
          </p>
        </main>
      </div>
    );
  }

  const renderedHtml = DOMPurify.sanitize(
    marked.parse(content, { async: false }) as string,
  );

  return (
    <div className="min-h-[100dvh] bg-background pb-14 md:pb-0">
      <Nav onLogout={() => window.location.reload()} />
      <main className="container max-w-3xl mx-auto px-4 py-6">
        {/* Top bar */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div className="flex-1" />
          <span className="text-xs text-muted-foreground">
            {saving === "saving" && "Saving…"}
            {saving === "saved" && "✓ Saved"}
          </span>
          {isOwnerOrAdmin && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleToggleLock}
                title={page.locked ? "Unlock page" : "Lock page"}
              >
                {page.locked ? (
                  <Lock className="h-3.5 w-3.5" />
                ) : (
                  <Unlock className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={handleDelete}
                title="Delete page"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>

        {/* Title */}
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleSave}
          className="text-lg font-semibold border-0 border-b rounded-none px-0 mb-2 focus-visible:ring-0"
          disabled={isLocked}
          placeholder="Page title"
        />

        {/* Meta */}
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <span className="text-xs text-muted-foreground">
            {page.createdBy} · Updated {formatDate(page.updatedAt)}
          </span>
          {page.taggedUsers &&
            page.taggedUsers.length > 0 &&
            page.taggedUsers.map((u) => (
              <Badge
                key={u}
                variant="secondary"
                className="text-xs px-1.5 py-0 h-4"
              >
                {u}
              </Badge>
            ))}
          {page.locked && (
            <Badge variant="outline" className="text-xs px-1.5 py-0 h-4">
              <Lock className="h-2.5 w-2.5 mr-0.5" /> Locked
            </Badge>
          )}
        </div>

        {/* Mode toggle */}
        <div className="flex gap-1 mb-3">
          <Button
            variant={mode === "source" ? "default" : "ghost"}
            size="sm"
            onClick={() => setMode("source")}
          >
            <Code2 className="h-3.5 w-3.5 mr-1" /> Source
          </Button>
          <Button
            variant={mode === "preview" ? "default" : "ghost"}
            size="sm"
            onClick={() => setMode("preview")}
          >
            <Eye className="h-3.5 w-3.5 mr-1" /> Preview
          </Button>
        </div>

        {/* Editor / Preview */}
        {mode === "source" ? (
          <Textarea
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            className="font-mono text-sm min-h-[400px] resize-y"
            disabled={isLocked}
            placeholder="Write markdown here…"
          />
        ) : (
          <div
            className="prose prose-sm dark:prose-invert max-w-none min-h-[400px] rounded-md border p-4"
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        )}
      </main>
    </div>
  );
}
