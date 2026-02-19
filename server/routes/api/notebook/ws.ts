import { eq } from "drizzle-orm";
import { defineWebSocketHandler } from "h3";
import * as Y from "yjs";
import { db } from "@/db";
import { notebookPages } from "@/db/schema";

// ─── In-memory doc store ──────────────────────────────────────────────────────

interface DocEntry {
  ydoc: Y.Doc;
  peers: Map<string, { identity: string; peerId: string }>;
  saveTimer: ReturnType<typeof setTimeout> | null;
  lastSaved: number;
}

const docs = new Map<string, DocEntry>();

const SAVE_DEBOUNCE_MS = 5_000;
const _SAVE_INTERVAL_MS = 30_000;

async function getOrCreateDoc(pageId: string): Promise<DocEntry | null> {
  if (docs.has(pageId)) return docs.get(pageId)!;

  // Load from DB
  const [page] = await db
    .select({ content: notebookPages.content })
    .from(notebookPages)
    .where(eq(notebookPages.id, pageId))
    .limit(1);

  if (!page) return null;

  const ydoc = new Y.Doc();
  const ytext = ydoc.getText("content");
  if (page.content) {
    ytext.insert(0, page.content);
  }

  const entry: DocEntry = {
    ydoc,
    peers: new Map(),
    saveTimer: null,
    lastSaved: Date.now(),
  };

  // Listen for updates to schedule saves
  ydoc.on("update", () => {
    scheduleSave(pageId, entry);
  });

  docs.set(pageId, entry);
  return entry;
}

function scheduleSave(pageId: string, entry: DocEntry) {
  if (entry.saveTimer) clearTimeout(entry.saveTimer);
  entry.saveTimer = setTimeout(
    () => persistDoc(pageId, entry),
    SAVE_DEBOUNCE_MS,
  );
}

async function persistDoc(pageId: string, entry: DocEntry) {
  try {
    const content = entry.ydoc.getText("content").toString();
    await db
      .update(notebookPages)
      .set({ content, updatedAt: new Date() })
      .where(eq(notebookPages.id, pageId));
    entry.lastSaved = Date.now();
    console.log(`[notebook:ws] Saved page ${pageId.slice(0, 8)}…`);
  } catch (e) {
    console.error(`[notebook:ws] Save failed for ${pageId}:`, e);
  }
}

function destroyDocIfEmpty(pageId: string) {
  const entry = docs.get(pageId);
  if (!entry || entry.peers.size > 0) return;

  // Save before destroying
  if (entry.saveTimer) clearTimeout(entry.saveTimer);
  persistDoc(pageId, entry).then(() => {
    entry.ydoc.destroy();
    docs.delete(pageId);
    console.log(`[notebook:ws] Destroyed doc ${pageId.slice(0, 8)}…`);
  });
}

function broadcastToOthers(
  entry: DocEntry,
  excludePeerId: string,
  message: object,
) {
  const data = JSON.stringify(message);
  for (const [, peer] of entry.peers) {
    if (peer.peerId !== excludePeerId) {
      try {
        // We'll send via the peer's websocket — stored in a parallel map
        const ws = peerSockets.get(peer.peerId);
        if (ws) ws.send(data);
      } catch {}
    }
  }
}

// Map peerId → websocket peer for sending
const peerSockets = new Map<string, any>();

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function authenticateToken(
  token: string,
): Promise<{ identity: string; isAdmin: boolean } | null> {
  const { authenticateTokenAsync } = await import("@/lib/auth");
  return authenticateTokenAsync(token);
}

// ─── WebSocket Handler ────────────────────────────────────────────────────────

export default defineWebSocketHandler({
  async open(peer) {
    // Parse query params from URL: ?page=<id>&token=<token>
    const url = new URL(peer.request.url, "http://localhost");
    const pageId = url.searchParams.get("page");
    const token = url.searchParams.get("token");

    if (!pageId || !token) {
      peer.send(
        JSON.stringify({ type: "error", message: "Missing page or token" }),
      );
      peer.close(4000, "Missing params");
      return;
    }

    const auth = await authenticateToken(token);
    if (!auth) {
      peer.send(JSON.stringify({ type: "error", message: "Unauthorized" }));
      peer.close(4001, "Unauthorized");
      return;
    }

    const entry = await getOrCreateDoc(pageId);
    if (!entry) {
      peer.send(JSON.stringify({ type: "error", message: "Page not found" }));
      peer.close(4004, "Not found");
      return;
    }

    const peerId = peer.id;

    // Store peer info
    entry.peers.set(peerId, { identity: auth.identity, peerId });
    peerSockets.set(peerId, peer);

    // Store context on peer for later use
    (peer as any)._ctx = { pageId, peerId, identity: auth.identity };

    // Send initial sync: full document state
    const state = Y.encodeStateAsUpdate(entry.ydoc);
    peer.send(
      JSON.stringify({
        type: "sync",
        update: Array.from(state),
      }),
    );

    // Send current viewers
    const viewers = [...entry.peers.values()].map((p) => p.identity);
    const viewerMsg = JSON.stringify({ type: "viewers", viewers });
    for (const [, p] of entry.peers) {
      const ws = peerSockets.get(p.peerId);
      if (ws)
        try {
          ws.send(viewerMsg);
        } catch {}
    }

    console.log(
      `[notebook:ws] ${auth.identity} joined ${pageId.slice(0, 8)}… (${entry.peers.size} peers)`,
    );
  },

  async message(peer, rawMessage) {
    const ctx = (peer as any)._ctx;
    if (!ctx) return;

    const { pageId, peerId } = ctx;
    const entry = docs.get(pageId);
    if (!entry) return;

    try {
      const msg = JSON.parse(
        typeof rawMessage === "string" ? rawMessage : rawMessage.text(),
      );

      if (msg.type === "update" && Array.isArray(msg.update)) {
        // Check if page is locked or archived before accepting edits
        const [currentPage] = await db
          .select({
            locked: notebookPages.locked,
            archivedAt: notebookPages.archivedAt,
          })
          .from(notebookPages)
          .where(eq(notebookPages.id, pageId))
          .limit(1);

        if (currentPage?.archivedAt) {
          peer.send(
            JSON.stringify({ type: "error", message: "Page is archived" }),
          );
          return;
        }

        if (currentPage?.locked) {
          peer.send(
            JSON.stringify({ type: "error", message: "Page is locked" }),
          );
          return;
        }

        // Apply Yjs update from client
        const update = new Uint8Array(msg.update);
        Y.applyUpdate(entry.ydoc, update, peerId);

        // Broadcast to other peers
        broadcastToOthers(entry, peerId, {
          type: "update",
          update: msg.update,
        });
      }
    } catch (e) {
      console.error("[notebook:ws] message error:", e);
    }
  },

  async close(peer) {
    const ctx = (peer as any)._ctx;
    if (!ctx) return;

    const { pageId, peerId, identity } = ctx;
    const entry = docs.get(pageId);

    peerSockets.delete(peerId);

    if (entry) {
      entry.peers.delete(peerId);
      console.log(
        `[notebook:ws] ${identity} left ${pageId.slice(0, 8)}… (${entry.peers.size} peers)`,
      );

      // Broadcast updated viewers
      const viewers = [...entry.peers.values()].map((p) => p.identity);
      const viewerMsg = JSON.stringify({ type: "viewers", viewers });
      for (const [, p] of entry.peers) {
        const ws = peerSockets.get(p.peerId);
        if (ws)
          try {
            ws.send(viewerMsg);
          } catch {}
      }

      // Destroy if no peers left
      setTimeout(() => destroyDocIfEmpty(pageId), 10_000);
    }
  },

  error(_peer, error) {
    console.error("[notebook:ws] error:", error);
  },
});
