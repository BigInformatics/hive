import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { InboxView } from "@/components/inbox";
import { LoginGate } from "@/components/login-gate";
import { SetupProfile } from "@/components/setup-profile";
import { getMailboxKey } from "@/lib/api";

export const Route = createFileRoute("/")({
  component: Home,
});

type AppState = "loading" | "unauthenticated" | "setup" | "ready";

interface UserInfo {
  displayName: string;
  isAdmin: boolean;
}

async function checkFirstRun(key: string): Promise<{
  needsSetup: boolean;
  user: UserInfo | null;
}> {
  // Skip if the user has already completed setup this session
  if (localStorage.getItem("hive-setup-complete")) {
    return { needsSetup: false, user: null };
  }

  try {
    const [verifyRes, usersRes] = await Promise.all([
      fetch("/api/auth/verify", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
      }),
      fetch("/api/users", {
        headers: { Authorization: `Bearer ${key}` },
      }),
    ]);

    if (!verifyRes.ok || !usersRes.ok) return { needsSetup: false, user: null };

    const { identity, isAdmin } = await verifyRes.json();
    const { users } = await usersRes.json();

    // Show setup when: user is admin AND there's only one user (fresh install)
    if (isAdmin && Array.isArray(users) && users.length <= 1) {
      const me = users.find((u: { id: string }) => u.id === identity);
      return {
        needsSetup: true,
        user: {
          displayName: me?.displayName ?? identity,
          isAdmin,
        },
      };
    }
  } catch {
    // Silently fall through — don't block the app if this check fails
  }

  return { needsSetup: false, user: null };
}

function Home() {
  const [state, setState] = useState<AppState>("loading");
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);

  useEffect(() => {
    const key = getMailboxKey();
    if (!key) {
      setState("unauthenticated");
      return;
    }

    checkFirstRun(key).then(({ needsSetup, user }) => {
      if (needsSetup) {
        setUserInfo(user);
        setState("setup");
      } else {
        setState("ready");
      }
    });
  }, []);

  const handleLogin = () => {
    const key = getMailboxKey();
    if (!key) return;
    checkFirstRun(key).then(({ needsSetup, user }) => {
      if (needsSetup) {
        setUserInfo(user);
        setState("setup");
      } else {
        setState("ready");
      }
    });
  };

  if (state === "loading") return null;

  if (state === "unauthenticated") {
    return <LoginGate onLogin={handleLogin} />;
  }

  if (state === "setup" && userInfo) {
    return (
      <SetupProfile
        currentDisplayName={userInfo.displayName}
        onComplete={() => setState("ready")}
      />
    );
  }

  return <InboxView onLogout={() => setState("unauthenticated")} />;
}
