import { Check, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { getMailboxKey } from "@/lib/api";

interface UserSelectProps {
  value: string[];
  onChange: (users: string[]) => void;
  className?: string;
}

export function UserSelect({ value, onChange, className }: UserSelectProps) {
  const [users, setUsers] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const key = getMailboxKey();
    if (!key) return;
    fetch("/api/users", {
      headers: { Authorization: `Bearer ${key}` },
    })
      .then((r) => r.json())
      .then((data) => {
        // data.users is HiveUser[] — extract ids for this string-based picker
        const ids: string[] = (data.users || []).map(
          (u: { id: string }) => u.id,
        );
        const all = new Set([...ids, ...value]);
        setUsers([...all].sort());
      })
      .catch(() => {});
  }, [value]);

  const filtered = users.filter(
    (u) => !search || u.toLowerCase().includes(search.toLowerCase()),
  );

  // Allow adding a custom username by pressing Enter
  const handleAddCustom = () => {
    const name = search.trim().toLowerCase();
    if (name && !value.includes(name)) {
      onChange([...value, name]);
      if (!users.includes(name)) setUsers((prev) => [...prev, name].sort());
    }
    setSearch("");
  };

  const toggle = (user: string) => {
    onChange(
      value.includes(user) ? value.filter((u) => u !== user) : [...value, user],
    );
  };

  return (
    <div className={className}>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 border-dashed w-full justify-start text-muted-foreground font-normal"
          >
            <Users className="mr-2 h-3.5 w-3.5" />
            {value.length > 0 ? (
              <span className="flex items-center gap-1.5">
                <span className="text-foreground">{value.length} selected</span>
                <Separator orientation="vertical" className="h-4" />
                <span className="flex gap-1 flex-wrap">
                  {value.slice(0, 3).map((u) => (
                    <Badge
                      key={u}
                      variant="secondary"
                      className="text-xs px-1.5 py-0 h-4 rounded-sm"
                    >
                      {u}
                    </Badge>
                  ))}
                  {value.length > 3 && (
                    <Badge
                      variant="secondary"
                      className="text-xs px-1.5 py-0 h-4 rounded-sm"
                    >
                      +{value.length - 3}
                    </Badge>
                  )}
                </span>
              </span>
            ) : (
              "Everyone — click to restrict"
            )}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[280px] p-0 gap-0">
          <DialogHeader className="px-3 pt-3 pb-2">
            <DialogTitle className="text-sm font-medium">
              Visible to
            </DialogTitle>
          </DialogHeader>
          <div className="px-3 pb-2">
            <Input
              placeholder="Search or type a name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddCustom();
                }
              }}
              className="h-8 text-sm"
              autoFocus
            />
          </div>
          <Separator />
          <div className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-4">
                No users found.
              </p>
            ) : (
              filtered.map((user) => {
                const selected = value.includes(user);
                return (
                  <button
                    key={user}
                    type="button"
                    onClick={() => toggle(user)}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent cursor-pointer text-left"
                  >
                    <div
                      className={`flex h-4 w-4 items-center justify-center rounded-sm border ${
                        selected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-muted-foreground/30"
                      }`}
                    >
                      {selected && <Check className="h-3 w-3" />}
                    </div>
                    <span>{user}</span>
                  </button>
                );
              })
            )}
          </div>
          {value.length > 0 && (
            <>
              <Separator />
              <div className="p-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-center text-xs h-7"
                  onClick={() => onChange([])}
                >
                  Clear — visible to everyone
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
