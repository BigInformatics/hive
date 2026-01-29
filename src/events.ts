// Simple pub-sub for real-time mailbox events

export type MailboxEvent = 
  | { type: "message"; recipient: string; sender: string; messageId: string; title: string; urgent: boolean }
  | { type: "inbox_check"; mailbox: string; action: "list" | "ack" | "search" };

type Listener = (event: MailboxEvent) => void;

const listeners = new Map<string, Set<Listener>>();

/** Subscribe to events for a specific mailbox */
export function subscribe(mailbox: string, listener: Listener): () => void {
  if (!listeners.has(mailbox)) {
    listeners.set(mailbox, new Set());
  }
  listeners.get(mailbox)!.add(listener);
  
  // Return unsubscribe function
  return () => {
    listeners.get(mailbox)?.delete(listener);
    if (listeners.get(mailbox)?.size === 0) {
      listeners.delete(mailbox);
    }
  };
}

/** Emit an event to all listeners for a mailbox */
export function emit(mailbox: string, event: MailboxEvent): void {
  const mailboxListeners = listeners.get(mailbox);
  if (mailboxListeners) {
    for (const listener of mailboxListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[events] Listener error:", err);
      }
    }
  }
}

/** Get count of active listeners (for debugging) */
export function listenerCount(): number {
  let count = 0;
  for (const set of listeners.values()) {
    count += set.size;
  }
  return count;
}
