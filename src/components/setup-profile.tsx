import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getMailboxKey } from "@/lib/api";

interface SetupProfileProps {
  currentDisplayName: string;
  onComplete: () => void;
}

/**
 * First-run setup screen — shown when the superuser logs in for the first time
 * and hasn't set a proper display name yet (or when there are no other users,
 * indicating a fresh install).
 */
export function SetupProfile({
  currentDisplayName,
  onComplete,
}: SetupProfileProps) {
  const [name, setName] = useState(currentDisplayName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    setError("");

    try {
      const key = getMailboxKey();
      const res = await fetch("/api/auth/setup-profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ displayName: name.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save display name");
        return;
      }

      // Mark setup as done so we don't show this again
      localStorage.setItem("hive-setup-complete", "1");
      onComplete();
    } catch {
      setError("Network error — try again");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-semibold">Welcome to Hive!</h1>
          </div>

          <p className="text-sm text-muted-foreground mb-6">
            Your instance is ready. Before you dive in, what should we call you?
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Display Name
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Chris"
                required
                autoFocus
                maxLength={100}
              />
            </div>

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={submitting || !name.trim()}
            >
              {submitting ? "Saving..." : "Let's go →"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
