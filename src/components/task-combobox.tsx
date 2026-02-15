import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";

interface TaskOption {
  id: string;
  title: string;
  projectId: string | null;
}

export function TaskCombobox({
  value,
  onChange,
  tasks,
  projectId,
  excludeId,
  placeholder = "Search tasks...",
}: {
  value: string;
  onChange: (id: string) => void;
  tasks: TaskOption[];
  projectId?: string;
  excludeId?: string;
  placeholder?: string;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Find the selected task to display its title
  const selected = tasks.find((t) => t.id === value);

  // Filter tasks: prefer same project, exclude self, match search
  const filtered = tasks
    .filter((t) => {
      if (excludeId && t.id === excludeId) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          t.title.toLowerCase().includes(q) ||
          t.id.toLowerCase().startsWith(q)
        );
      }
      // When no search, show same-project tasks first
      return true;
    })
    .sort((a, b) => {
      // Same project first
      if (projectId) {
        if (a.projectId === projectId && b.projectId !== projectId) return -1;
        if (b.projectId === projectId && a.projectId !== projectId) return 1;
      }
      return a.title.localeCompare(b.title);
    })
    .slice(0, 10);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      <Input
        value={focused ? search : selected ? selected.title : value ? value.slice(0, 8) : ""}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setFocused(true);
          setSearch("");
          setOpen(true);
        }}
        onBlur={() => {
          // Delay to allow click on dropdown
          setTimeout(() => setFocused(false), 200);
        }}
        placeholder={placeholder}
      />
      {value && !focused && (
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground text-xs"
          onClick={() => {
            onChange("");
            setSearch("");
          }}
        >
          ✕
        </button>
      )}
      {open && focused && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-48 overflow-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">No tasks found</div>
          ) : (
            filtered.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors ${
                  t.id === value ? "bg-accent" : ""
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(t.id);
                  setSearch("");
                  setOpen(false);
                  setFocused(false);
                }}
              >
                <span className="block truncate">{t.title}</span>
                <span className="text-[10px] font-mono text-muted-foreground/50">{t.id.slice(0, 8)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
