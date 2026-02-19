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
  localStorage.removeItem("hive-identity");
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
  ) =>
    apiFetch(`/mailboxes/${recipient}/messages`, {
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

  createWebhook: (data: {
    appName: string;
    title: string;
    forUsers?: string;
  }) =>
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
    websiteUrl?: string;
    onedevUrl?: string;
    githubUrl?: string;
  }) =>
    apiFetch("/swarm/projects", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateProject: (id: string, data: Record<string, unknown>) =>
    apiFetch(`/swarm/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  archiveProject: (id: string) =>
    apiFetch(`/swarm/projects/${id}/archive`, {
      method: "POST",
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
    if (params?.includeCompleted) searchParams.set("includeCompleted", "true");
    const qs = searchParams.toString();
    return apiFetch(`/swarm/tasks${qs ? `?${qs}` : ""}`);
  },

  createTask: (data: {
    title: string;
    projectId?: string;
    detail?: string;
    followUp?: string;
    issueUrl?: string;
    assigneeUserId?: string;
    status?: string;
    mustBeDoneAfterTaskId?: string;
    onOrAfterAt?: string;
    nextTaskId?: string;
    nextTaskAssigneeUserId?: string;
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

  // Task notebook page links
  getTaskNotebookPages: (taskId: string) =>
    apiFetch(`/swarm/tasks/${taskId}/notebook-pages`),

  linkNotebookPage: (taskId: string, notebookPageId: string) =>
    apiFetch(`/swarm/tasks/${taskId}/notebook-pages`, {
      method: "POST",
      body: JSON.stringify({ notebookPageId }),
    }),

  unlinkNotebookPage: (taskId: string, notebookPageId: string) =>
    apiFetch(`/swarm/tasks/${taskId}/notebook-pages`, {
      method: "DELETE",
      body: JSON.stringify({ notebookPageId }),
    }),

  // Recurring templates
  listRecurringTemplates: (includeDisabled = false) =>
    apiFetch(
      `/swarm/recurring${includeDisabled ? "?includeDisabled=true" : ""}`,
    ),

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

  tickRecurring: () => apiFetch("/swarm/recurring/tick", { method: "POST" }),

  // Auth / Invites
  listInvites: () => apiFetch("/auth/invites"),

  createInvite: (data: {
    identityHint?: string;
    isAdmin?: boolean;
    maxUses?: number;
    expiresInHours?: number;
  }) =>
    apiFetch("/auth/invites", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  deleteInvite: (id: number) =>
    apiFetch(`/auth/invites/${id}`, { method: "DELETE" }),

  listTokens: () => apiFetch("/auth/tokens"),

  revokeToken: (id: number) =>
    apiFetch(`/auth/tokens/${id}/revoke`, { method: "POST" }),

  // Chat
  listChatChannels: () => apiFetch("/chat/channels"),

  openDm: (identity: string) =>
    apiFetch("/chat/channels", {
      method: "POST",
      body: JSON.stringify({ identity }),
    }),

  createGroupChat: (name: string, members: string[]) =>
    apiFetch("/chat/channels", {
      method: "POST",
      body: JSON.stringify({ type: "group", name, members }),
    }),

  getChatMessages: (
    channelId: string,
    params?: { limit?: number; before?: number },
  ) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.before) qs.set("before", String(params.before));
    const q = qs.toString();
    return apiFetch(`/chat/channels/${channelId}/messages${q ? `?${q}` : ""}`);
  },

  sendChatMessage: (channelId: string, body: string) =>
    apiFetch(`/chat/channels/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),

  markChatRead: (channelId: string) =>
    apiFetch(`/chat/channels/${channelId}/read`, { method: "POST" }),

  sendChatTyping: (channelId: string) =>
    apiFetch(`/chat/channels/${channelId}/typing`, { method: "POST" }),

  // Wake
  getWake: (identity?: string) =>
    apiFetch(identity ? `/wake/${identity}` : "/wake"),

  // Admin
  getUserStats: () => apiFetch("/admin/user-stats"),

  searchChatMessages: (params: {
    q: string;
    channelId?: string;
    sender?: string;
    before?: string;
    after?: string;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    qs.set("q", params.q);
    if (params.channelId) qs.set("channelId", params.channelId);
    if (params.sender) qs.set("sender", params.sender);
    if (params.before) qs.set("before", params.before);
    if (params.after) qs.set("after", params.after);
    if (params.limit) qs.set("limit", String(params.limit));
    return apiFetch(`/chat/search?${qs.toString()}`);
  },

  // Directory
  listDirectory: (q?: string, limit?: number, offset?: number) => {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (limit) qs.set("limit", String(limit));
    if (offset) qs.set("offset", String(offset));
    const s = qs.toString();
    return apiFetch(`/directory${s ? `?${s}` : ""}`);
  },
  createDirectoryEntry: (data: {
    title: string;
    url: string;
    description?: string;
    taggedUsers?: string[];
  }) =>
    apiFetch("/directory", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteDirectoryEntry: (id: number) =>
    apiFetch(`/directory/${id}`, { method: "DELETE" }),

  // Notebook
  listNotebookPages: (q?: string, limit?: number, offset?: number) => {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (limit) qs.set("limit", String(limit));
    if (offset) qs.set("offset", String(offset));
    const s = qs.toString();
    return apiFetch(`/notebook${s ? `?${s}` : ""}`);
  },
  createNotebookPage: (data: {
    title: string;
    content?: string;
    taggedUsers?: string[];
    tags?: string[];
    expiresAt?: string | null;
    reviewAt?: string | null;
  }) =>
    apiFetch("/notebook", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getNotebookPage: (id: string) => apiFetch(`/notebook/${id}`),
  updateNotebookPage: (
    id: string,
    data: {
      title?: string;
      content?: string;
      taggedUsers?: string[];
      tags?: string[];
      locked?: boolean;
      expiresAt?: string | null;
      reviewAt?: string | null;
    },
  ) =>
    apiFetch(`/notebook/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteNotebookPage: (id: string) =>
    apiFetch(`/notebook/${id}`, { method: "DELETE" }),
};
