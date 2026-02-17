import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { getMailboxKey, api } from "@/lib/api";
import { useChatSSE, type ChatSSEEvent } from "@/lib/use-chat-sse";
import { LoginGate } from "@/components/login-gate";
import { Nav } from "@/components/nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  RefreshCw,
  Mail,
  Clock,
  MessageCircle,
  Send,
  ArrowLeft,
  Users,
  Plus,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/presence")({
  component: PresencePage,
});

interface UserPresence {
  online: boolean;
  lastSeen: string | null;
  source: string | null;
  unread: number;
}

interface ChatChannel {
  id: string;
  type: string;
  name: string | null;
  created_by: string;
  members: Array<{ identity: string }>;
  last_message: {
    id: number;
    sender: string;
    body: string;
    created_at: string;
  } | null;
  unread_count: number;
}

interface ChatMessage {
  id: number;
  channelId: string;
  sender: string;
  body: string;
  createdAt: string;
}

const AVATARS: Record<string, string> = {
  chris: "/avatars/chris.jpg",
  clio: "/avatars/clio.png",
  domingo: "/avatars/domingo.jpg",
  zumie: "/avatars/zumie.png",
};

const ALL_USERS = ["chris", "clio", "domingo", "zumie"];

function getTimeSince(date: string | null): number {
  if (!date) return Infinity;
  return (Date.now() - new Date(date).getTime()) / 1000;
}

function formatLastSeen(date: string | null): string {
  if (!date) return "Never seen";
  const seconds = getTimeSince(date);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatMessageTime(date: string): string {
  const d = new Date(date);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function getBorderOpacity(online: boolean, lastSeen: string | null): number {
  if (online) return 1.0;
  const seconds = getTimeSince(lastSeen);
  if (seconds < 300) return 0.8;
  if (seconds < 900) return 0.6;
  if (seconds < 3600) return 0.4;
  if (seconds < 86400) return 0.25;
  return 0.15;
}

function getMyIdentity(): string {
  // Try to get identity from stored key verification
  try {
    const stored = localStorage.getItem("hive-identity");
    if (stored) return stored;
  } catch {}
  return "unknown";
}

/** Verify identity on mount — ensures localStorage is correct even if login predated identity storage */
function useVerifiedIdentity(): string {
  const [identity, setIdentity] = useState(getMyIdentity);

  useEffect(() => {
    const key = getMailboxKey();
    if (!key) return;

    fetch("/api/auth/verify", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.identity) {
          localStorage.setItem("hive-identity", data.identity);
          setIdentity(data.identity);
        }
      })
      .catch(() => {});
  }, []);

  return identity;
}

function PresencePage() {
  const [authed, setAuthed] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setAuthed(!!getMailboxKey());
    setChecked(true);
  }, []);

  if (!checked) return null;
  if (!authed) return <LoginGate onLogin={() => setAuthed(true)} />;

  return <PresenceView onLogout={() => setAuthed(false)} />;
}

function PresenceView({ onLogout }: { onLogout: () => void }) {
  const [presence, setPresence] = useState<Record<string, UserPresence>>({});
  const [loading, setLoading] = useState(false);
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [activeChannel, setActiveChannel] = useState<string | null>(null);
  const [showChats, setShowChats] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [chatEvent, setChatEvent] = useState<ChatSSEEvent | null>(null);
  const myIdentity = useVerifiedIdentity();

  // SSE for real-time chat events
  useChatSSE((evt) => {
    setChatEvent(evt);
    // Refresh channel list on new messages (for unread counts, last message preview)
    if (evt.type === "chat_message") {
      fetchChannels();
    }
  });

  const fetchPresence = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getPresence();
      setPresence(data);
    } catch (err) {
      console.error("Failed to fetch presence:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchChannels = useCallback(async () => {
    try {
      const data = await api.listChatChannels();
      setChannels(data.channels || []);
    } catch (err) {
      console.error("Failed to fetch channels:", err);
    }
  }, []);

  useEffect(() => {
    fetchPresence();
    fetchChannels();
  }, [fetchPresence, fetchChannels]);

  // Reduced polling — SSE handles real-time, this is just a fallback
  useEffect(() => {
    const interval = setInterval(() => {
      fetchPresence();
      fetchChannels();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchPresence, fetchChannels]);

  const openDm = async (identity: string) => {
    try {
      const result = await api.openDm(identity);
      setActiveChannel(result.channelId);
      setShowChats(true);
      fetchChannels();
    } catch (err) {
      console.error("Failed to open DM:", err);
    }
  };

  const totalUnread = channels.reduce((sum, ch) => sum + ch.unread_count, 0);

  const users = ALL_USERS.map((name) => ({
    name,
    info: presence[name] || {
      online: false,
      lastSeen: null,
      source: null,
      unread: 0,
    },
  })).sort((a, b) => {
    if (a.info.online !== b.info.online) return a.info.online ? -1 : 1;
    const aTime = a.info.lastSeen ? new Date(a.info.lastSeen).getTime() : 0;
    const bTime = b.info.lastSeen ? new Date(b.info.lastSeen).getTime() : 0;
    return bTime - aTime;
  });

  const getChannelName = (ch: ChatChannel): string => {
    if (ch.name) return ch.name;
    const others = ch.members
      .map((m) => m.identity)
      .filter((id) => id !== myIdentity);
    return others.join(", ") || "Chat";
  };

  return (
    <div className="flex flex-col bg-background h-[100dvh] md:h-screen pb-14 md:pb-0">
      <Nav onLogout={onLogout} />

      <div className="flex flex-1 overflow-hidden">
        {/* Left side: Presence + Chat list */}
        <div className={`flex flex-col border-r ${activeChannel ? "hidden md:flex" : "flex"} w-full md:w-80 shrink-0`}>
          {/* Presence header */}
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="font-medium text-sm">Team</span>
            <div className="flex items-center gap-1">
              <Button
                variant={showChats ? "secondary" : "ghost"}
                size="sm"
                className="text-xs h-7 gap-1"
                onClick={() => setShowChats(!showChats)}
              >
                <MessageCircle className="h-3.5 w-3.5" />
                Chats
                {totalUnread > 0 && (
                  <Badge variant="destructive" className="h-4 min-w-4 text-[10px] px-1">
                    {totalUnread}
                  </Badge>
                )}
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fetchPresence} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          {!showChats ? (
            /* Presence grid */
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-1">
                {users.map(({ name, info }) => {
                  const borderOpacity = getBorderOpacity(info.online, info.lastSeen);
                  const avatar = AVATARS[name];
                  return (
                    <div
                      key={name}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => openDm(name)}
                    >
                      <div
                        className="relative rounded-full p-0.5 shrink-0"
                        style={{
                          boxShadow: `0 0 0 2px rgba(34, 197, 94, ${borderOpacity})`,
                        }}
                      >
                        {avatar ? (
                          <img src={avatar} alt={name} className="h-10 w-10 rounded-full object-cover" />
                        ) : (
                          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-sm font-bold uppercase text-muted-foreground">
                            {name[0]}
                          </div>
                        )}
                        {info.online && (
                          <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-green-500 border-2 border-background" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm capitalize">{name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {info.online
                            ? `Online${info.source ? ` via ${info.source}` : ""}`
                            : formatLastSeen(info.lastSeen)}
                        </p>
                      </div>
                      <MessageCircle className="h-4 w-4 text-muted-foreground/30 hover:text-foreground shrink-0" />
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          ) : (
            /* Chat list */
            <ScrollArea className="flex-1">
              <div className="p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-xs gap-1.5 mb-1"
                  onClick={() => setGroupDialogOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" /> New group chat
                </Button>
                {channels.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-8">
                    No chats yet. Click a team member to start.
                  </p>
                )}
                {channels.map((ch) => {
                  const name = getChannelName(ch);
                  const isGroup = ch.type === "group";
                  const otherUser = !isGroup
                    ? ch.members.find((m) => m.identity !== myIdentity)?.identity
                    : null;
                  const avatar = otherUser ? AVATARS[otherUser] : null;

                  return (
                    <div
                      key={ch.id}
                      className={`flex items-center gap-2.5 p-2 rounded-lg cursor-pointer transition-colors ${
                        activeChannel === ch.id ? "bg-muted" : "hover:bg-muted/50"
                      }`}
                      onClick={() => setActiveChannel(ch.id)}
                    >
                      {isGroup ? (
                        <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                          <Users className="h-4 w-4 text-muted-foreground" />
                        </div>
                      ) : avatar ? (
                        <img src={avatar} alt={name} className="h-9 w-9 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center text-sm font-bold uppercase text-muted-foreground shrink-0">
                          {name[0]}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-sm capitalize truncate">{name}</p>
                          {ch.last_message && (
                            <span className="text-[10px] text-muted-foreground shrink-0 ml-1">
                              {formatMessageTime(ch.last_message.created_at)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted-foreground truncate">
                            {ch.last_message
                              ? `${ch.last_message.sender}: ${ch.last_message.body}`
                              : "No messages yet"}
                          </p>
                          {ch.unread_count > 0 && (
                            <Badge variant="destructive" className="h-4 min-w-4 text-[10px] px-1 ml-1 shrink-0">
                              {ch.unread_count}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Right side: Active chat */}
        <div className={`flex-1 flex flex-col ${activeChannel ? "flex" : "hidden md:flex"}`}>
          {activeChannel ? (
            <ChatPanel
              channelId={activeChannel}
              channels={channels}
              myIdentity={myIdentity}
              onBack={() => setActiveChannel(null)}
              onMessageSent={fetchChannels}
              chatEvent={chatEvent}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <MessageCircle className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Select a team member to chat</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <NewGroupDialog
        open={groupDialogOpen}
        onOpenChange={setGroupDialogOpen}
        onCreated={(channelId) => {
          setActiveChannel(channelId);
          setGroupDialogOpen(false);
          fetchChannels();
        }}
      />
    </div>
  );
}

/* ─── Chat Panel ─── */

function ChatPanel({
  channelId,
  channels,
  myIdentity,
  onBack,
  onMessageSent,
  chatEvent,
}: {
  channelId: string;
  channels: ChatChannel[];
  myIdentity: string;
  onBack: () => void;
  onMessageSent: () => void;
  chatEvent: ChatSSEEvent | null;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Map<string, number>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastTypingSent = useRef(0);

  const channel = channels.find((c) => c.id === channelId);
  const channelName = channel
    ? channel.name || channel.members.map((m) => m.identity).filter((id) => id !== myIdentity).join(", ")
    : "Chat";

  const fetchMessages = useCallback(async () => {
    try {
      const data = await api.getChatMessages(channelId);
      setMessages(data.messages || []);
    } catch (err) {
      console.error("Failed to fetch messages:", err);
    }
  }, [channelId]);

  useEffect(() => {
    fetchMessages();
    inputRef.current?.focus();
  }, [fetchMessages]);

  // Handle SSE events — real-time message arrival
  useEffect(() => {
    if (!chatEvent) return;

    if (chatEvent.type === "chat_message" && chatEvent.channelId === channelId) {
      const msg = chatEvent.message;
      setMessages((prev) => {
        // Avoid duplicates (from optimistic add or double-delivery)
        if (prev.some((m) => m.id === msg.id)) return prev;
        // Replace optimistic message (fake ID > 1e12) from same sender with same body
        const optimisticIdx = prev.findIndex(
          (m) => m.id > 1e12 && m.sender === msg.sender && m.body === msg.body
        );
        if (optimisticIdx !== -1) {
          const next = [...prev];
          next[optimisticIdx] = {
            id: msg.id,
            channelId,
            sender: msg.sender,
            body: msg.body,
            createdAt: msg.createdAt,
          };
          return next;
        }
        return [...prev, {
          id: msg.id,
          channelId,
          sender: msg.sender,
          body: msg.body,
          createdAt: msg.createdAt,
        }];
      });
      // Clear typing indicator for this sender
      setTypingUsers((prev) => {
        const next = new Map(prev);
        next.delete(msg.sender);
        return next;
      });
      // Mark as read since we're looking at it
      api.markChatRead(channelId).catch(() => {});
    }

    if (chatEvent.type === "chat_typing" && chatEvent.channelId === channelId) {
      setTypingUsers((prev) => {
        const next = new Map(prev);
        next.set(chatEvent.identity, Date.now());
        return next;
      });
    }
  }, [chatEvent, channelId]);

  // Clear stale typing indicators every 4s
  useEffect(() => {
    const interval = setInterval(() => {
      setTypingUsers((prev) => {
        const now = Date.now();
        const next = new Map(prev);
        for (const [user, ts] of next) {
          if (now - ts > 4000) next.delete(user);
        }
        return next.size !== prev.size ? next : prev;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // Fallback poll (much slower now — SSE handles real-time)
  useEffect(() => {
    const interval = setInterval(fetchMessages, 30000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Send typing indicator (throttled to once per 3s)
  const sendTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current > 3000) {
      lastTypingSent.current = now;
      api.sendChatTyping(channelId).catch(() => {});
    }
  }, [channelId]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sending) return;

    const text = input.trim();
    setInput("");
    setSending(true);

    // Optimistic add
    const optimistic: ChatMessage = {
      id: Date.now(),
      channelId,
      sender: myIdentity,
      body: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      await api.sendChatMessage(channelId, text);
      onMessageSent();
    } catch (err) {
      console.error("Failed to send:", err);
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  const activeTypers = [...typingUsers.keys()].filter((u) => u !== myIdentity);

  return (
    <>
      {/* Chat header */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {channel?.type === "group" ? (
          <Users className="h-5 w-5 text-muted-foreground" />
        ) : (
          (() => {
            const other = channel?.members.find((m) => m.identity !== myIdentity)?.identity;
            const avatar = other ? AVATARS[other] : null;
            return avatar ? (
              <img src={avatar} alt="" className="h-7 w-7 rounded-full object-cover" />
            ) : (
              <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold uppercase">
                {channelName[0]}
              </div>
            );
          })()
        )}
        <div>
          <p className="font-medium text-sm capitalize">{channelName}</p>
          {channel && (
            <p className="text-[10px] text-muted-foreground">
              {channel.members.map((m) => m.identity).join(", ")}
            </p>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-auto p-4 space-y-1">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">
            No messages yet. Say hello!
          </p>
        )}
        {messages.map((msg, i) => {
          const isMe = msg.sender === myIdentity;
          const showSender =
            !isMe && (i === 0 || messages[i - 1].sender !== msg.sender);
          const avatar = AVATARS[msg.sender];

          return (
            <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] ${isMe ? "items-end" : "items-start"}`}>
                {showSender && (
                  <p className="text-[10px] text-muted-foreground ml-1 mb-0.5 capitalize">
                    {msg.sender}
                  </p>
                )}
                <div
                  className={`px-3 py-1.5 rounded-2xl text-sm ${
                    isMe
                      ? "bg-primary text-primary-foreground rounded-br-md"
                      : "bg-muted rounded-bl-md"
                  }`}
                >
                  {msg.body}
                </div>
                <p className={`text-[9px] text-muted-foreground/50 mt-0.5 ${isMe ? "text-right mr-1" : "ml-1"}`}>
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Typing indicator */}
      {activeTypers.length > 0 && (
        <div className="px-4 py-1">
          <p className="text-xs text-muted-foreground animate-pulse capitalize">
            {activeTypers.join(", ")} {activeTypers.length === 1 ? "is" : "are"} typing...
          </p>
        </div>
      )}

      {/* Compose */}
      <form onSubmit={handleSend} className="border-t p-3 flex gap-2">
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (e.target.value.trim()) sendTyping();
          }}
          placeholder="Type a message..."
          className="flex-1"
          autoComplete="off"
        />
        <Button type="submit" size="icon" disabled={!input.trim() || sending}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </>
  );
}

/* ─── New Group Dialog ─── */

function NewGroupDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (channelId: string) => void;
}) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  const toggle = (user: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(user)) next.delete(user);
      else next.add(user);
      return next;
    });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || selected.size === 0) return;
    setCreating(true);
    try {
      const result = await api.createGroupChat(name.trim(), [...selected]);
      setName("");
      setSelected(new Set());
      onCreated(result.channelId);
    } catch (err) {
      console.error("Failed to create group:", err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New Group Chat</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleCreate} className="space-y-4">
          <Input
            placeholder="Group name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
          <div>
            <p className="text-xs text-muted-foreground mb-2">Members</p>
            <div className="flex flex-wrap gap-2">
              {ALL_USERS.map((user) => (
                <Button
                  key={user}
                  type="button"
                  variant={selected.has(user) ? "default" : "outline"}
                  size="sm"
                  className="text-xs capitalize"
                  onClick={() => toggle(user)}
                >
                  {user}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={creating || !name.trim() || selected.size === 0}>
              {creating ? "Creating..." : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
