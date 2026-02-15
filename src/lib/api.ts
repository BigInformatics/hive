// Client-side API helpers for the Hive UI

const API_BASE = "/api";

function getStoredKey(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("hive-mailbox-key");
}

export function setMailboxKey(key: string) {
  localStorage.setItem("hive-mailbox-key", key);
}

export function getMailboxKey(): string | null {
  return getStoredKey();
}

export function clearMailboxKey() {
  localStorage.removeItem("hive-mailbox-key");
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const key = getStoredKey();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (key) {
    headers.Authorization = `Bearer ${key}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `API error: ${res.status}`);
  }

  return res.json();
}

// Messages
export const api = {
  listMessages: (params?: { status?: string; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set("status", params.status);
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    const qs = searchParams.toString();
    return apiFetch(`/mailboxes/me/messages${qs ? `?${qs}` : ""}`);
  },

  sendMessage: (
    recipient: string,
    data: { title: string; body?: string; urgent?: boolean },
  ) => apiFetch(`/mailboxes/${recipient}/messages`, {
    method: "POST",
    body: JSON.stringify(data),
  }),

  ackMessage: (id: number) =>
    apiFetch(`/mailboxes/me/messages/${id}/ack`, { method: "POST" }),

  ackMessages: (ids: number[]) =>
    apiFetch("/mailboxes/me/messages/ack", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),

  replyToMessage: (id: number, body: string) =>
    apiFetch(`/mailboxes/me/messages/${id}/reply`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),

  searchMessages: (q: string) =>
    apiFetch(`/mailboxes/me/messages/search?q=${encodeURIComponent(q)}`),

  getPresence: () => apiFetch("/presence"),
};
