import {
  AlertTriangle,
  Check,
  CheckCheck,
  Copy,
  Hourglass,
  Reply,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

interface Message {
  id: number;
  sender: string;
  recipient: string;
  title: string;
  body: string | null;
  status: "unread" | "read";
  urgent: boolean;
  createdAt: string;
  responseWaiting?: boolean;
  waitingResponder?: string | null;
  waitingSince?: string | null;
}

export function MessageDetail({
  message,
  onAck,
  onReply,
  onTogglePending,
  onAutoRead,
}: {
  message: Message;
  onAck: () => void;
  onReply: (body: string) => Promise<void>;
  onTogglePending?: () => void;
  onAutoRead?: () => void;
}) {
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [showReply, setShowReply] = useState(false);
  const [copied, setCopied] = useState(false);
  const autoReadRef = useRef<ReturnType<typeof setTimeout>>();

  // Auto-read after 5 seconds of viewing
  useEffect(() => {
    if (message.status === "unread" && onAutoRead) {
      autoReadRef.current = setTimeout(() => {
        onAutoRead();
      }, 5000);
    }
    return () => {
      if (autoReadRef.current) clearTimeout(autoReadRef.current);
    };
  }, [message.status, onAutoRead]);

  const handleReply = async () => {
    if (!replyText.trim()) return;
    setReplying(true);
    try {
      await onReply(replyText);
      setReplyText("");
      setShowReply(false);
    } catch (err) {
      console.error("Reply failed:", err);
    } finally {
      setReplying(false);
    }
  };

  const formattedDate = new Date(message.createdAt).toLocaleString();

  return (
    <ScrollArea className="h-full">
      <div className="p-6">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              {message.urgent && (
                <AlertTriangle className="h-4 w-4 text-destructive" />
              )}
              <h2 className="text-lg font-semibold">{message.title}</h2>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <button
                type="button"
                className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer"
                onClick={() => {
                  navigator.clipboard.writeText(String(message.id));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                title="Copy message ID"
              >
                {copied ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                #{message.id}
              </button>
              <span>
                From: <strong>{message.sender}</strong>
              </span>
              <span>→</span>
              <span>
                <strong>{message.recipient}</strong>
              </span>
              <span>•</span>
              <span>{formattedDate}</span>
            </div>
          </div>
          <div className="flex gap-1">
            {message.status === "unread" && (
              <Button variant="outline" size="sm" onClick={onAck}>
                <CheckCheck className="mr-1 h-3.5 w-3.5" /> Mark read
              </Button>
            )}
            {onTogglePending && (
              <Button
                variant={message.responseWaiting ? "default" : "outline"}
                size="sm"
                onClick={onTogglePending}
              >
                <Hourglass className="mr-1 h-3.5 w-3.5" />
                {message.responseWaiting ? "Clear Pending" : "Mark Pending"}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowReply(!showReply)}
            >
              <Reply className="mr-1 h-3.5 w-3.5" /> Reply
            </Button>
          </div>
        </div>

        {/* Status badges */}
        <div className="mb-4 flex gap-2 flex-wrap">
          <Badge
            variant={message.status === "unread" ? "default" : "secondary"}
          >
            {message.status}
          </Badge>
          {message.urgent && <Badge variant="destructive">urgent</Badge>}
          {message.responseWaiting && (
            <Badge
              variant="default"
              className="bg-amber-500 hover:bg-amber-600 gap-1"
            >
              <Hourglass className="h-3 w-3" />
              Pending Response
              {message.waitingResponder && ` (${message.waitingResponder})`}
            </Badge>
          )}
        </div>

        {/* Body */}
        <div className="prose prose-sm dark:prose-invert max-w-none">
          {message.body ? (
            <pre className="whitespace-pre-wrap font-sans">{message.body}</pre>
          ) : (
            <p className="text-muted-foreground italic">No body</p>
          )}
        </div>

        {/* Reply */}
        {showReply && (
          <div className="mt-6 space-y-3 border-t pt-4">
            <Textarea
              placeholder={`Reply to ${message.sender}...`}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              rows={4}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowReply(false)}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleReply} disabled={replying}>
                {replying ? "Sending..." : "Send reply"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
