import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { setMailboxKey } from "@/lib/api";

export function LoginGate({
  onLogin,
}: {
  onLogin: () => void;
}) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;

    setLoading(true);
    setError("");

    // Test the key by hitting presence
    try {
      const res = await fetch("/api/presence", {
        headers: { Authorization: `Bearer ${key.trim()}` },
      });
      if (!res.ok) throw new Error("Invalid key");

      setMailboxKey(key.trim());
      onLogin();
    } catch {
      setError("Invalid mailbox key");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">🐝 Hive</CardTitle>
          <p className="text-sm text-muted-foreground">
            Enter your mailbox key to continue
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <Input
              type="password"
              placeholder="Mailbox key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoFocus
            />
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Checking..." : "Enter Hive"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
