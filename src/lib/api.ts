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

  listSentMessages: (params?: { limit?: number }) => {
    const qs = params?.limit ? `?limit=${params.limit}` : "";
    return apiFetch(`/mailboxes/me/sent${qs}`);
  },

  markPending: (id: number) =>
    apiFetch(`/mailboxes/me/messages/${id}/pending`, { method: "POST" }),

  clearPending: (id: number) =>
    apiFetch(`/mailboxes/me/messages/${id}/pending`, { method: "DELETE" }),

  getPresence: () => apiFetch("/presence"),

  // Broadcast
  listBroadcastEvents: (appName?: string) => {
    const params = appName ? `?appName=${encodeURIComponent(appName)}` : "";
    return apiFetch(`/broadcast/events${params}`);
  },

  listWebhooks: () => apiFetch("/broadcast/webhooks"),

  createWebhook: (data: { appName: string; title: string; forUsers?: string }) =>
    apiFetch("/broadcast/webhooks", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateWebhook: (id: number, data: Record<string, unknown>) =>
    apiFetch(`/broadcast/webhooks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteWebhook: (id: number) =>
    apiFetch(`/broadcast/webhooks/${id}`, { method: "DELETE" }),

  // Swarm
  listProjects: () => apiFetch("/swarm/projects"),

  createProject: (data: {
    title: string;
    color: string;
    description?: string;
    projectLeadUserId?: string;
    developerLeadUserId?: string;
  }) =>
    apiFetch("/swarm/projects", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  listTasks: (params?: {
    statuses?: string;
    assignee?: string;
    projectId?: string;
    includeCompleted?: boolean;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.statuses) searchParams.set("statuses", params.statuses);
    if (params?.assignee) searchParams.set("assignee", params.assignee);
    if (params?.projectId) searchParams.set("projectId", params.projectId);
    if (params?.includeCompleted)
      searchParams.set("includeCompleted", "true");
    const qs = searchParams.toString();
    return apiFetch(`/swarm/tasks${qs ? `?${qs}` : ""}`);
  },

  createTask: (data: {
    title: string;
    projectId?: string;
    detail?: string;
    issueUrl?: string;
    assigneeUserId?: string;
    status?: string;
  }) =>
    apiFetch("/swarm/tasks", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateTaskStatus: (id: string, status: string) =>
    apiFetch(`/swarm/tasks/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  updateTask: (id: string, data: Record<string, unknown>) =>
    apiFetch(`/swarm/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  // Recurring templates
  listRecurringTemplates: (includeDisabled = false) =>
    apiFetch(`/swarm/recurring${includeDisabled ? "?includeDisabled=true" : ""}`),

  createRecurringTemplate: (data: {
    title: string;
    cronExpr: string;
    projectId?: string;
    detail?: string;
    assigneeUserId?: string;
    timezone?: string;
    initialStatus?: string;
  }) =>
    apiFetch("/swarm/recurring", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateRecurringTemplate: (id: string, data: Record<string, unknown>) =>
    apiFetch(`/swarm/recurring/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteRecurringTemplate: (id: string) =>
    apiFetch(`/swarm/recurring/${id}`, { method: "DELETE" }),

  tickRecurring: () =>
    apiFetch("/swarm/recurring/tick", { method: "POST" }),
};
