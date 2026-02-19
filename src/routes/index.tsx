import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { InboxView } from "@/components/inbox";
import { LoginGate } from "@/components/login-gate";
import { getMailboxKey } from "@/lib/api";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const [authed, setAuthed] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setAuthed(!!getMailboxKey());
    setChecked(true);
  }, []);

  if (!checked) return null;

  if (!authed) {
    return <LoginGate onLogin={() => setAuthed(true)} />;
  }

  return <InboxView onLogout={() => setAuthed(false)} />;
}
