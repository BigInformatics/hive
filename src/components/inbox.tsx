import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Inbox as InboxIcon,
  Archive,
  Send,
  Search,
  CheckCheck,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { Nav } from "./nav";
import { ComposeDialog } from "./compose-dialog";
import { MessageDetail } from "./message-detail";

interface Message {
  id: number;
  recipient: string;
  sender: string;
  title: string;
  body: string | null;
  status: "unread" | "read";
  urgent: boolean;
  createdAt: string;
  viewedAt: string | null;
  threadId: string | null;
  replyToMessageId: number | null;
  responseWaiting: boolean;
  waitingResponder: string | null;
  waitingSince: string | null;
}

function timeAgo(date: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(date).getTime()) / 1000,
  );
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function InboxView({ onLogout }: { onLogout: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [tab, setTab] = useState("unread");
  const [loading, setLoading] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);

  const fetchMessages = useCallback(async (currentTab?: string) => {
    setLoading(true);
    try {
      if (currentTab === "sent") {
        const result = await api.listSentMessages({ limit: 50 });
        setMessages(result.messages || []);
      } else {
        const result = await api.listMessages({
          status: currentTab === "all" ? undefined : currentTab,
          limit: 50,
        });
        setMessages(result.messages || []);
      }
    } catch (err) {
      console.error("Failed to fetch messages:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const result = await api.searchMessages(searchQuery);
      setMessages(result.messages || []);
      setTab("search");
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (tab !== "search") {
      fetchMessages(tab);
    }
  }, [tab, fetchMessages]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (tab !== "search") {
        fetchMessages(tab);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [tab, fetchMessages]);

  const handleAck = async (id: number) => {
    try {
      await api.ackMessage(id);
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, status: "read" as const } : m)),
      );
      if (selectedMessage?.id === id) {
        setSelectedMessage({ ...selectedMessage, status: "read" });
      }
    } catch (err) {
      console.error("Failed to ack message:", err);
    }
  };

  const handleAckAll = async () => {
    const unreadIds = messages.filter((m) => m.status === "unread").map((m) => m.id);
    if (unreadIds.length === 0) return;
    try {
      await api.ackMessages(unreadIds);
      setMessages((prev) => prev.map((m) => ({ ...m, status: "read" as const })));
    } catch (err) {
      console.error("Failed to ack all:", err);
    }
  };

  const handleLogout = () => {
    onLogout();
  };

  const unreadCount = messages.filter((m) => m.status === "unread").length;

  return (
    <div className="flex flex-col bg-background h-[100dvh] md:h-screen pb-14 md:pb-0">
      {/* Header */}
      <Nav onLogout={handleLogout} />
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <Badge variant="destructive">{unreadCount} unread</Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => fetchMessages(tab === "all" ? undefined : tab)}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setComposeOpen(true)}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="border-b px-4 py-2">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Search messages..."
            className="flex-1 rounded-md border bg-transparent px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleSearch}
            disabled={searching}
          >
            <Search className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Message list */}
        <div className="flex w-full flex-col border-r md:w-96">
          <Tabs
            value={tab}
            onValueChange={(v) => {
              setTab(v);
              setSelectedMessage(null);
            }}
            className="flex flex-col flex-1 overflow-hidden"
          >
            <TabsList className="mx-4 mt-2">
              <TabsTrigger value="unread">
                <InboxIcon className="mr-1 h-3.5 w-3.5" /> Unread
              </TabsTrigger>
              <TabsTrigger value="read">
                <Archive className="mr-1 h-3.5 w-3.5" /> Read
              </TabsTrigger>
              <TabsTrigger value="sent">
                <Send className="mr-1 h-3.5 w-3.5" /> Sent
              </TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>

            <TabsContent value={tab} className="flex-1 overflow-hidden mt-0">
              {tab === "unread" && messages.length > 0 && (
                <div className="flex justify-end px-4 py-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleAckAll}
                    className="text-xs"
                  >
                    <CheckCheck className="mr-1 h-3 w-3" /> Mark all read
                  </Button>
                </div>
              )}
              <ScrollArea className="h-full">
                <div className="space-y-1 p-2">
                  {messages.length === 0 && !loading && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      {tab === "search" ? "No results" : "No messages"}
                    </p>
                  )}
                  {messages.map((msg) => (
                    <button
                      key={msg.id}
                      type="button"
                      className={`w-full rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted/50 ${
                        selectedMessage?.id === msg.id ? "bg-muted" : ""
                      } ${msg.status === "unread" ? "font-medium" : "opacity-75"}`}
                      onClick={() => setSelectedMessage(msg)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {msg.urgent && (
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                          )}
                          {msg.status === "unread" && (
                            <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                          )}
                          <span className="truncate text-sm">
                            {msg.title}
                          </span>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {timeAgo(msg.createdAt)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">
                          {tab === "sent" ? `to ${msg.recipient}` : `from ${msg.sender}`}
                        </span>
                        {msg.responseWaiting && (
                          <span className="text-[10px] text-amber-500 font-medium">⏳ pending</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>

        {/* Detail pane */}
        <div className="hidden flex-1 md:block">
          {selectedMessage ? (
            <MessageDetail
              message={selectedMessage}
              onAck={() => handleAck(selectedMessage.id)}
              onReply={async (body) => {
                await api.replyToMessage(selectedMessage.id, body);
                // Auto-ack on reply
                if (selectedMessage.status === "unread") {
                  await api.ackMessage(selectedMessage.id);
                  setSelectedMessage({ ...selectedMessage, status: "read" });
                }
                fetchMessages(tab);
              }}
              onTogglePending={async () => {
                if (selectedMessage.responseWaiting) {
                  const updated = await api.clearPending(selectedMessage.id);
                  setSelectedMessage({ ...selectedMessage, responseWaiting: false, waitingResponder: null, waitingSince: null });
                } else {
                  const updated = await api.markPending(selectedMessage.id);
                  setSelectedMessage({ ...selectedMessage, responseWaiting: true, waitingResponder: "me", waitingSince: new Date().toISOString() });
                }
                fetchMessages(tab);
              }}
              onAutoRead={() => {
                if (selectedMessage.status === "unread") {
                  handleAck(selectedMessage.id);
                }
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <p>Select a message to read</p>
            </div>
          )}
        </div>
      </div>

      {/* Compose */}
      <ComposeDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        onSent={() => fetchMessages(tab === "all" ? undefined : tab)}
      />
    </div>
  );
}
