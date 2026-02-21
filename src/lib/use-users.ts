import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export interface HiveUser {
  id: string;
  displayName: string;
  isAdmin: boolean;
  isAgent: boolean;
  avatarUrl: string | null;
}

let cachedUsers: HiveUser[] | null = null;
let cacheExpires = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/** Fetch all active users. Results are cached in-memory for 5 minutes. */
export function useUsers(): HiveUser[] {
  const [users, setUsers] = useState<HiveUser[]>(cachedUsers ?? []);

  useEffect(() => {
    if (cachedUsers && Date.now() < cacheExpires) {
      setUsers(cachedUsers);
      return;
    }

    api
      .getUsers()
      .then((data: { users: HiveUser[] }) => {
        cachedUsers = data.users;
        cacheExpires = Date.now() + CACHE_TTL;
        setUsers(data.users);
      })
      .catch(() => {
        // Fall back to empty list — components should handle gracefully
      });
  }, []);

  return users;
}

/** Just the ids (strings) for backwards-compat with ALL_USERS / KNOWN_USERS patterns */
export function useUserIds(): string[] {
  return useUsers().map((u) => u.id);
}
