import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { setMailboxKey } from "@/lib/api";

export function LoginGate({ onLogin }: { onLogin: () => void }) {
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;

    setLoading(true);
    setError("");

    // Verify the key
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { Authorization: `Bearer ${key.trim()}` },
      });
      if (!res.ok) throw new Error("Invalid key");
      const data = await res.json();

      setMailboxKey(key.trim());
      if (data.identity) {
        localStorage.setItem("hive-identity", data.identity);
      }
      onLogin();
    } catch {
      setError("Invalid key — check your SUPERUSER_TOKEN or personal token");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <img
              src="/logo-light.png"
              alt="Hive"
              className="h-12 w-auto dark:hidden"
            />
            <img
              src="/logo-dark.png"
              alt="Hive"
              className="h-12 w-auto hidden dark:block"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Enter your Hive key to continue
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <div className="relative">
                <Input
                  type={showKey ? "text" : "password"}
                  placeholder="Hive key"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  autoFocus
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                  aria-label={showKey ? "Hide key" : "Show key"}
                >
                  {showKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                First time? Use the{" "}
                <code className="font-mono bg-muted px-1 rounded">
                  SUPERUSER_TOKEN
                </code>{" "}
                from your{" "}
                <code className="font-mono bg-muted px-1 rounded">.env</code>{" "}
                file. Agents use their personal token from{" "}
                <code className="font-mono bg-muted px-1 rounded">
                  HIVE_TOKEN
                </code>
                .
              </p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Checking..." : "Enter Hive"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
