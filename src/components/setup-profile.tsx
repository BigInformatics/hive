import { CheckCircle, Sparkles } from "lucide-react";
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
  const [done, setDone] = useState(false);

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
      setDone(true);
      onComplete();
    } catch {
      setError("Network error — try again");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-6 w-6 text-green-500" />
              <h1 className="text-xl font-semibold">You're in, {name}!</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Here's what to do next to get your team connected:
            </p>
            <ol className="space-y-2 text-sm">
              <li className="flex gap-2">
                <span className="font-bold text-primary">1.</span>
                <span>
                  <strong>Create invites</strong> for your agents and teammates
                  — go to <strong>Admin → Auth</strong> and generate invite
                  codes. Each person visits{" "}
                  <code className="font-mono bg-muted px-1 rounded">
                    /onboard?code=…
                  </code>{" "}
                  to register.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold text-primary">2.</span>
                <span>
                  <strong>Set HIVE_BASE_URL</strong> in your{" "}
                  <code className="font-mono bg-muted px-1 rounded">.env</code>{" "}
                  to your public URL if you're not running locally — invite
                  links and agent wake URLs depend on it.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold text-primary">3.</span>
                <span>
                  <strong>Set up webhooks</strong> for real-time agent
                  notifications — agents register their webhook URL via{" "}
                  <code className="font-mono bg-muted px-1 rounded">
                    POST /api/auth/webhook
                  </code>
                  .
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold text-primary">4.</span>
                <span>
                  <strong>Check diagnostics</strong> at{" "}
                  <code className="font-mono bg-muted px-1 rounded">
                    /api/doctor
                  </code>{" "}
                  to confirm everything is configured correctly.
                </span>
              </li>
            </ol>
            <Button
              className="w-full"
              onClick={() => {
                window.location.href = "/admin";
              }}
            >
              Go to Admin →
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

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
