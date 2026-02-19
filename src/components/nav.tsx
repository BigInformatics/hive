import { Link, useLocation } from "@tanstack/react-router";
import {
  Bookmark,
  BookOpen,
  Inbox,
  LayoutList,
  LogOut,
  Radio,
  Settings,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { api, clearMailboxKey } from "@/lib/api";
import { ThemeToggle } from "./theme-toggle";

const navItems = [
  { to: "/", label: "Inbox", icon: Inbox },
  { to: "/buzz", label: "Buzz", icon: Radio },
  { to: "/swarm", label: "Swarm", icon: LayoutList },
  { to: "/directory", label: "Directory", icon: Bookmark },
  { to: "/notebook", label: "Notebook", icon: BookOpen },
  { to: "/presence", label: "Presence", icon: Users },
  { to: "/admin", label: "Admin", icon: Settings },
] as const;

// Avatars served via /api/avatars/:identity with UserAvatar component

const ALL_USERS = ["chris", "clio", "domingo", "zumie"];

interface UserPresence {
  online: boolean;
  lastSeen: string | null;
  source: string | null;
  unread: number;
}

function getTimeSince(date: string | null): number {
  if (!date) return Infinity;
  return (Date.now() - new Date(date).getTime()) / 1000;
}

function getBorderColor(online: boolean, lastSeen: string | null): string {
  if (online) return "rgba(34, 197, 94, 1)";
  const seconds = getTimeSince(lastSeen);
  if (seconds < 300) return "rgba(34, 197, 94, 0.8)";
  if (seconds < 900) return "rgba(34, 197, 94, 0.6)";
  if (seconds < 3600) return "rgba(34, 197, 94, 0.4)";
  if (seconds < 86400) return "rgba(34, 197, 94, 0.25)";
  return "rgba(34, 197, 94, 0.15)";
}

function PresenceDots() {
  const [presence, setPresence] = useState<Record<string, UserPresence>>({});

  useEffect(() => {
    api
      .getPresence()
      .then(setPresence)
      .catch(() => {});
    const interval = setInterval(() => {
      api
        .getPresence()
        .then(setPresence)
        .catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, []);

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

  return (
    <div className="flex items-center gap-1.5">
      {users.map(({ name, info }) => {
        const borderColor = getBorderColor(info.online, info.lastSeen);
        return (
          <div
            key={name}
            className="rounded-full transition-all duration-500"
            style={{ boxShadow: `0 0 0 2px ${borderColor}`, padding: "1.5px" }}
            title={`${name}${info.online ? " (online)" : ""}`}
          >
            <UserAvatar name={name} size="md" className="h-6 w-6" />
          </div>
        );
      })}
    </div>
  );
}

export function Nav({ onLogout }: { onLogout: () => void }) {
  const location = useLocation();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const fetchUnread = () => {
      api
        .listMessages({ status: "unread", limit: 1 })
        .then((data: any) =>
          setUnreadCount(data.total ?? data.messages?.length ?? 0),
        )
        .catch(() => {});
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = () => {
    clearMailboxKey();
    onLogout();
  };

  return (
    <>
      {/* Desktop / iPad header */}
      <header className="hidden md:flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold">🐝 Hive</h1>
          <nav className="flex gap-1">
            {navItems.map((item) => {
              const isActive =
                item.to === "/"
                  ? location.pathname === "/"
                  : location.pathname.startsWith(item.to);
              return (
                <Link key={item.to} to={item.to}>
                  <Button
                    variant={isActive ? "default" : "ghost"}
                    size="sm"
                    className="gap-1.5 relative"
                  >
                    <item.icon className="h-3.5 w-3.5" />
                    {item.label}
                    {item.to === "/" && unreadCount > 0 && (
                      <Badge
                        variant="destructive"
                        className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 text-[10px] flex items-center justify-center"
                      >
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </Badge>
                    )}
                  </Button>
                </Link>
              );
            })}
          </nav>
          <PresenceDots />
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" size="icon" onClick={handleLogout}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Mobile header — minimal */}
      <header className="flex md:hidden items-center justify-between border-b px-3 py-2">
        <h1 className="text-lg font-bold">🐝 Hive</h1>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Mobile bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex md:hidden items-center justify-around border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-1 py-1 safe-bottom">
        {navItems.map((item) => {
          const isActive =
            item.to === "/"
              ? location.pathname === "/"
              : location.pathname.startsWith(item.to);
          return (
            <Link key={item.to} to={item.to} className="flex-1">
              <button
                type="button"
                className={`flex flex-col items-center gap-0.5 w-full py-1.5 rounded-md transition-colors ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <div className="relative">
                  <item.icon className="h-5 w-5" />
                  {item.to === "/" && unreadCount > 0 && (
                    <span className="absolute -top-1 -right-2 h-4 min-w-4 px-1 text-[9px] font-bold bg-destructive text-destructive-foreground rounded-full flex items-center justify-center">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-medium">{item.label}</span>
              </button>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
