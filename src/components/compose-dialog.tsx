import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useUserIds } from "@/lib/use-users";

export function ComposeDialog({
  open,
  onOpenChange,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
}) {
  const knownRecipients = useUserIds();
  const [recipient, setRecipient] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setRecipient("");
    setTitle("");
    setBody("");
    setUrgent(false);
    setError("");
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipient || !title) return;

    setSending(true);
    setError("");

    try {
      await api.sendMessage(recipient, {
        title,
        body: body || undefined,
        urgent,
      });
      reset();
      onOpenChange(false);
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] !max-w-[90vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Message</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSend} className="space-y-4">
          <div className="space-y-2">
            <Label>To</Label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {knownRecipients.map((r) => (
                <Button
                  key={r}
                  type="button"
                  variant={recipient === r ? "default" : "outline"}
                  size="sm"
                  onClick={() => setRecipient(r)}
                >
                  {r}
                </Button>
              ))}
            </div>
            <Input
              placeholder="Or type a recipient..."
              value={recipient}
              onChange={(e) => setRecipient(e.target.value.toLowerCase())}
            />
          </div>

          <div className="space-y-2">
            <Label>Subject</Label>
            <Input
              placeholder="Message title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Body</Label>
            <Textarea
              placeholder="Message body (optional)"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="urgent"
              checked={urgent}
              onChange={(e) => setUrgent(e.target.checked)}
              className="rounded"
            />
            <Label htmlFor="urgent" className="text-sm font-normal">
              Mark as urgent
            </Label>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={sending || !recipient || !title}>
              {sending ? "Sending..." : "Send"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
