import { createFileRoute } from "@tanstack/react-router";
import DOMPurify from "dompurify";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Check,
  Clock,
  Code2,
  Copy,
  Eye,
  Link2,
  Lock,
  Plus,
  Tag,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import { marked } from "marked";
import { useCallback, useEffect, useRef, useState } from "react";
import { LoginGate } from "@/components/login-gate";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Nav } from "@/components/nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserSelect } from "@/components/user-select";
import { api, getMailboxKey } from "@/lib/api";

export const Route = createFileRoute("/notebook")({
  component: NotebookPage,
});

interface PageSummary {
  id: string;
  title: string;
  createdBy: string;
  taggedUsers: string[] | null;
  tags: string[] | null;
  locked: boolean;
  lockedBy: string | null;
  expiresAt: string | null;
  reviewAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface FullPage extends PageSummary {
  content: string;
}

/** Format an ISO timestamp as a local datetime-local input value (YYYY-MM-DDTHH:MM) */
function toLocalDatetimeValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  const [selectedPageId, setSelectedPageId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("page");
  });

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
  const [filterTags, setFilterTags] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("notebook-filter-tags");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
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

  // Persist tag filter
  useEffect(() => {
    try {
      if (filterTags.length > 0)
        localStorage.setItem(
          "notebook-filter-tags",
          JSON.stringify(filterTags),
        );
      else localStorage.removeItem("notebook-filter-tags");
    } catch {}
  }, [filterTags]);

  // Collect all unique tags from pages
  const allTags = [...new Set(pages.flatMap((p) => p.tags ?? []))].sort();

  // Filter pages by selected tags
  const filteredPages =
    filterTags.length > 0
      ? pages.filter(
          (p) => p.tags && filterTags.some((t) => p.tags?.includes(t)),
        )
      : pages;

  const toggleTag = (tag: string) => {
    setFilterTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

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
      <main className="w-[90vw] max-w-[90vw] mx-auto px-4 py-6">
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
                  <UserSelect value={newTagged} onChange={setNewTagged} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
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

        {/* Tag filter */}
        {allTags.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <Tag className="h-3.5 w-3.5 text-muted-foreground" />
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                  filterTags.includes(tag)
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            ))}
            {filterTags.length > 0 && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setFilterTags([])}
              >
                Clear
              </button>
            )}
          </div>
        )}

        {loading ? (
          <p className="text-center text-muted-foreground text-sm py-16">
            Loading…
          </p>
        ) : error ? (
          <p className="text-center text-destructive text-sm py-16">{error}</p>
        ) : filteredPages.length === 0 ? (
          <p className="text-center text-muted-foreground text-sm py-16">
            {search || filterTags.length > 0
              ? "No pages match your filters."
              : "No pages yet — create the first one!"}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {filteredPages.map((page) => {
              const isExpired =
                page.expiresAt && new Date(page.expiresAt) < new Date();
              const needsReview =
                page.reviewAt && new Date(page.reviewAt) < new Date();
              return (
                <Card
                  key={page.id}
                  className={`cursor-pointer hover:bg-accent/50 transition-colors ${isExpired ? "opacity-60" : ""}`}
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
                          {isExpired && (
                            <Badge
                              variant="destructive"
                              className="text-[10px] px-1.5 py-0 h-4"
                            >
                              Expired
                            </Badge>
                          )}
                          {needsReview && !isExpired && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 h-4 text-amber-500 border-amber-500/30"
                            >
                              Needs Review
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-muted-foreground">
                            {page.createdBy} · {formatDate(page.updatedAt)}
                          </span>
                          {page.taggedUsers && page.taggedUsers.length > 0 && (
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
                          {page.tags && page.tags.length > 0 && (
                            <span className="flex gap-1 flex-wrap">
                              {page.tags.map((t) => (
                                <Badge
                                  key={t}
                                  variant="outline"
                                  className="text-[10px] px-1.5 py-0 h-4"
                                >
                                  <Tag className="h-2.5 w-2.5 mr-0.5" />
                                  {t}
                                </Badge>
                              ))}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
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
  const [mode, setMode] = useState<"source" | "preview">("preview");
  const [saving, _setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [identity, setIdentity] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [viewers, setViewers] = useState<string[]>([]);
  const [copied, setCopied] = useState<"idle" | "url" | "content">("idle");
  const contentRef = useRef(content);
  const authToken = getMailboxKey();

  // Get current user identity
  useEffect(() => {
    if (authToken) {
      fetch("/api/auth/verify", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      })
        .then((r) => r.json())
        .then((d) => {
          setIdentity(d.identity);
          setIsAdmin(d.isAdmin ?? false);
        })
        .catch(() => {});
    }
  }, [authToken]);

  const handleCopyUrl = () => {
    const url = `${window.location.origin}/notebook?page=${pageId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied("url");
      setTimeout(() => setCopied("idle"), 2000);
    });
  };

  const handleCopyContent = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied("content");
      setTimeout(() => setCopied("idle"), 2000);
    });
  };

  const handleTaggedUsersChange = async (users: string[]) => {
    if (!page) return;
    try {
      const data = await api.updateNotebookPage(pageId, {
        taggedUsers: users.length > 0 ? users : [],
      });
      setPage(data.page);
    } catch (e: any) {
      alert(e?.message ?? "Failed to update visibility");
    }
  };

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

  // Auto-refresh in preview mode (poll every 10s for changes)
  useEffect(() => {
    if (mode !== "preview") return;
    const interval = setInterval(async () => {
      try {
        const data = await api.getNotebookPage(pageId);
        if (data.page) {
          // Only update if content actually changed
          if (data.page.content !== contentRef.current) {
            setContent(data.page.content);
            contentRef.current = data.page.content;
          }
          setPage(data.page);
          // Only update title if it changed server-side (avoid overwriting in-progress edits)
          setTitle((prev) =>
            prev !== data.page.title ? data.page.title : prev,
          );
        }
      } catch {}
    }, 10_000);
    return () => clearInterval(interval);
  }, [mode, pageId]);

  const handleContentChange = useCallback((val: string) => {
    setContent(val);
    contentRef.current = val;
  }, []);

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
      // Switch to preview when locking
      if (data.page.locked) setMode("preview");
    } catch (e: any) {
      alert(e?.message ?? "Failed to toggle lock");
    }
  };

  const handleDelete = async () => {
    if (!confirm("Archive this page? It can be restored later.")) return;
    try {
      await api.deleteNotebookPage(pageId);
      onBack();
    } catch (e: any) {
      alert(e?.message ?? "Failed to delete");
    }
  };

  const isOwnerOrAdmin = page
    ? identity === page.createdBy || isAdmin
    : false;
  const isLocked = !!page?.locked;
  const isArchived = !!page?.archivedAt;

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-background pb-14 md:pb-0">
        <Nav onLogout={() => window.location.reload()} />
        <main className="w-[90vw] max-w-[90vw] mx-auto px-4 py-6">
          <p className="text-center text-muted-foreground py-16">Loading…</p>
        </main>
      </div>
    );
  }

  if (error || !page) {
    return (
      <div className="min-h-[100dvh] bg-background pb-14 md:pb-0">
        <Nav onLogout={() => window.location.reload()} />
        <main className="w-[90vw] max-w-[90vw] mx-auto px-4 py-6">
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
      <main className="w-[90vw] max-w-[90vw] mx-auto px-4 py-6">
        {/* Top bar */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div className="flex-1" />
          {/* Active viewers */}
          {viewers.length > 0 && (
            <div className="flex items-center gap-1 mr-1">
              <div className="flex -space-x-1.5">
                {viewers.slice(0, 5).map((v) => (
                  <div
                    key={v}
                    className="h-6 w-6 rounded-full bg-primary/15 border-2 border-background flex items-center justify-center text-[10px] font-medium text-primary"
                    title={v}
                  >
                    {v[0].toUpperCase()}
                  </div>
                ))}
              </div>
              {viewers.length > 5 && (
                <span className="text-xs text-muted-foreground ml-1">
                  +{viewers.length - 5}
                </span>
              )}
            </div>
          )}
          <span className="text-xs text-muted-foreground">
            {saving === "saving" && "Saving…"}
            {saving === "saved" && "✓ Saved"}
          </span>
          {/* Copy content */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleCopyContent}
            title="Copy page content"
          >
            {copied === "content" ? (
              <Check className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
          {/* Copy URL */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleCopyUrl}
            title="Copy page URL"
          >
            {copied === "url" ? (
              <Check className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <Link2 className="h-3.5 w-3.5" />
            )}
          </Button>
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
                title="Archive page"
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
          disabled={isLocked || isArchived}
          placeholder="Page title"
        />

        {/* Archived banner */}
        {isArchived && (
          <div className="flex items-center gap-2 rounded-md border border-muted-foreground/50 bg-muted px-3 py-2 mb-3 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              This page was archived on {formatDate(page.archivedAt!)}. Content
              is read-only.
            </span>
          </div>
        )}

        {/* Expiration / Review banners */}
        {page.expiresAt && new Date(page.expiresAt) < new Date() && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 mb-3 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              This page expired on {formatDate(page.expiresAt)}. Content is
              available as historical information only.
            </span>
          </div>
        )}
        {page.reviewAt &&
          new Date(page.reviewAt) < new Date() &&
          !(page.expiresAt && new Date(page.expiresAt) < new Date()) && (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 mb-3 text-sm text-amber-600 dark:text-amber-400">
              <Clock className="h-4 w-4 shrink-0" />
              <span>
                This page is past its review date ({formatDate(page.reviewAt)}).
                Content may be out of date and requires review.
              </span>
            </div>
          )}

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
          {page.tags &&
            page.tags.length > 0 &&
            page.tags.map((t) => (
              <Badge
                key={t}
                variant="outline"
                className="text-xs px-1.5 py-0 h-4"
              >
                <Tag className="h-2.5 w-2.5 mr-0.5" />
                {t}
              </Badge>
            ))}
        </div>

        {/* Mode toggle */}
        <div className="flex gap-1 mb-3">
          <Button
            variant={mode === "preview" ? "default" : "ghost"}
            size="sm"
            onClick={() => setMode("preview")}
          >
            <Eye className="h-3.5 w-3.5 mr-1" /> Preview
          </Button>
          <Button
            variant={mode === "source" ? "default" : "ghost"}
            size="sm"
            onClick={() => !isLocked && !isArchived && setMode("source")}
            disabled={isLocked || isArchived}
            title={
              isArchived
                ? "Page is archived"
                : isLocked
                  ? "Unlock the page to edit"
                  : undefined
            }
          >
            <Code2 className="h-3.5 w-3.5 mr-1" /> Source
          </Button>
        </div>

        {/* Editor / Preview */}
        {mode === "source" ? (
          <MarkdownEditor
            value={content}
            onChange={handleContentChange}
            disabled={!!isLocked}
            placeholder="Write markdown here…"
            pageId={pageId}
            token={authToken || undefined}
            onViewersChange={setViewers}
            onReadonlyChange={(ro) => {
              if (ro) {
                // Page became locked/archived while editing — reload page state and switch to preview
                api.getNotebookPage(pageId).then((data: any) => {
                  if (data.page) {
                    setPage(data.page);
                    setContent(data.page.content);
                    contentRef.current = data.page.content;
                  }
                });
                setMode("preview");
              }
            }}
          />
        ) : (
          <div
            className="prose prose-sm dark:prose-invert max-w-none min-h-[400px] rounded-md border p-4"
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        )}

        {/* Page settings */}
        {isOwnerOrAdmin && (
          <div className="mt-6 pt-4 border-t space-y-4">
            {/* Tags */}
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">
                Tags
              </Label>
              <TagEditor
                tags={page.tags ?? []}
                onChange={async (tags) => {
                  try {
                    const data = await api.updateNotebookPage(pageId, {
                      tags: tags.length > 0 ? tags : [],
                    });
                    setPage(data.page);
                  } catch (e: any) {
                    alert(e?.message ?? "Failed to update tags");
                  }
                }}
              />
            </div>

            {/* Dates */}
            <div className="flex gap-4 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <Label className="text-xs text-muted-foreground mb-1 block">
                  Expiration Date
                </Label>
                <input
                  type="datetime-local"
                  className="w-full rounded-md border bg-transparent px-3 py-1.5 text-sm"
                  value={
                    page.expiresAt ? toLocalDatetimeValue(page.expiresAt) : ""
                  }
                  onChange={async (e) => {
                    try {
                      const data = await api.updateNotebookPage(pageId, {
                        expiresAt: e.target.value
                          ? new Date(e.target.value).toISOString()
                          : null,
                      });
                      setPage(data.page);
                    } catch {}
                  }}
                />
              </div>
              <div className="flex-1 min-w-[200px]">
                <Label className="text-xs text-muted-foreground mb-1 block">
                  Review Date
                </Label>
                <input
                  type="datetime-local"
                  className="w-full rounded-md border bg-transparent px-3 py-1.5 text-sm"
                  value={
                    page.reviewAt ? toLocalDatetimeValue(page.reviewAt) : ""
                  }
                  onChange={async (e) => {
                    try {
                      const data = await api.updateNotebookPage(pageId, {
                        reviewAt: e.target.value
                          ? new Date(e.target.value).toISOString()
                          : null,
                      });
                      setPage(data.page);
                    } catch {}
                  }}
                />
              </div>
            </div>

            {/* Visibility */}
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">
                Visibility
              </Label>
              <UserSelect
                value={page.taggedUsers ?? []}
                onChange={handleTaggedUsersChange}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/* ─── Tag Editor ─── */

function TagEditor({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState("");

  const addTag = () => {
    const tag = input.trim().toLowerCase();
    if (tag && !tags.includes(tag)) {
      onChange([...tags, tag]);
    }
    setInput("");
  };

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {tags.map((tag) => (
        <Badge key={tag} variant="outline" className="gap-1 text-xs">
          <Tag className="h-2.5 w-2.5" />
          {tag}
          <button
            type="button"
            className="ml-0.5 hover:text-destructive transition-colors"
            onClick={() => onChange(tags.filter((t) => t !== tag))}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </Badge>
      ))}
      <Input
        placeholder="Add tag..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addTag();
          }
        }}
        className="h-6 w-28 text-xs px-2"
      />
    </div>
  );
}
