import { Link, useLocation } from "@tanstack/react-router";
import { Inbox, Radio, Users, LogOut, LayoutList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";
import { clearMailboxKey } from "@/lib/api";

const navItems = [
  { to: "/", label: "Inbox", icon: Inbox },
  { to: "/buzz", label: "Buzz", icon: Radio },
  { to: "/swarm", label: "Swarm", icon: LayoutList },
  { to: "/presence", label: "Presence", icon: Users },
] as const;

export function Nav({ onLogout }: { onLogout: () => void }) {
  const location = useLocation();

  const handleLogout = () => {
    clearMailboxKey();
    onLogout();
  };

  return (
    <header className="flex items-center justify-between border-b px-4 py-3">
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
                  className="gap-1.5"
                >
                  <item.icon className="h-3.5 w-3.5" />
                  {item.label}
                </Button>
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <Button variant="ghost" size="icon" onClick={handleLogout}>
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
