import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { getMailboxKey, api } from "@/lib/api";
import { LoginGate } from "@/components/login-gate";
import { Nav } from "@/components/nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Trash2, Plus, ExternalLink, Bookmark } from "lucide-react";

export const Route = createFileRoute("/directory")({
  component: DirectoryPage,
});

interface DirectoryEntry {
  id: number;
  title: string;
  url: string;
  description: string | null;
  createdBy: string;
  taggedUsers: string[] | null;
  createdAt: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const defaultForm = { title: "", url: "", description: "", taggedUsers: "" };

function DirectoryPage() {
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    setAuthed(!!getMailboxKey());
  }, []);
  if (!authed) return <LoginGate onLogin={() => setAuthed(true)} />;

  return <DirectoryContent />;
}

function DirectoryContent() {
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    setPageError(null);
    try {
      const data = await api.listDirectory(q || undefined);
      setEntries(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setPageError(e?.message ?? "Failed to load entries");
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

  const handleAdd = async () => {
    setFormError(null);
    if (!form.title.trim() || !form.url.trim()) {
      setFormError("Title and URL are required");
      return;
    }
    setSubmitting(true);
    try {
      const taggedUsers = form.taggedUsers.trim()
        ? form.taggedUsers
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
      await api.createDirectoryEntry({
        title: form.title.trim(),
        url: form.url.trim(),
        description: form.description.trim() || undefined,
        taggedUsers,
      });
      setDialogOpen(false);
      setForm(defaultForm);
      load(search);
    } catch (e: any) {
      setFormError(e?.message ?? "Failed to add entry");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this link?")) return;
    try {
      await api.deleteDirectoryEntry(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (e: any) {
      alert(e?.message ?? "Failed to delete");
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background pb-14 md:pb-0">
      <Nav onLogout={() => window.location.reload()} />
      <main className="container max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center gap-2 mb-5">
          <Bookmark className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Directory</h1>
        </div>

        <div className="flex items-center gap-3 mb-5">
          <Input
            placeholder="Search links…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1"
          />
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Add Link</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="d-title">Title *</Label>
                  <Input
                    id="d-title"
                    value={form.title}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, title: e.target.value }))
                    }
                    placeholder="e.g. Team Handbook"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="d-url">URL *</Label>
                  <Input
                    id="d-url"
                    value={form.url}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, url: e.target.value }))
                    }
                    placeholder="https://…"
                    type="url"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="d-desc">Description</Label>
                  <Input
                    id="d-desc"
                    value={form.description}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, description: e.target.value }))
                    }
                    placeholder="Optional short description"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="d-users">Visible to</Label>
                  <Input
                    id="d-users"
                    value={form.taggedUsers}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, taggedUsers: e.target.value }))
                    }
                    placeholder="alice, bob — or leave blank for everyone"
                  />
                </div>
                {formError && (
                  <p className="text-sm text-destructive">{formError}</p>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleAdd}
                  disabled={
                    submitting || !form.title.trim() || !form.url.trim()
                  }
                >
                  {submitting ? "Adding…" : "Add Link"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <p className="text-center text-muted-foreground text-sm py-16">
            Loading…
          </p>
        ) : pageError ? (
          <p className="text-center text-destructive text-sm py-16">
            {pageError}
          </p>
        ) : entries.length === 0 ? (
          <p className="text-center text-muted-foreground text-sm py-16">
            {search
              ? "No links match your search."
              : "No links yet — add the first one!"}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {entries.map((entry) => (
              <Card key={entry.id} className="group">
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <a
                          href={entry.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium hover:underline underline-offset-2 truncate"
                        >
                          {entry.title}
                        </a>
                        <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                      </div>
                      {entry.description && (
                        <p className="text-sm text-muted-foreground mb-1.5 line-clamp-2">
                          {entry.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground">
                          {entry.createdBy} · {formatDate(entry.createdAt)}
                        </span>
                        {entry.taggedUsers && entry.taggedUsers.length > 0 && (
                          <span className="flex gap-1 flex-wrap">
                            {entry.taggedUsers.map((u) => (
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
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(entry.id)}
                      title="Delete link"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
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
