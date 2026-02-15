// Simple pub-sub for real-time mailbox events

export type MailboxEvent =
  | {
      type: "message";
      recipient: string;
      sender: string;
      messageId: number;
      title: string;
      urgent: boolean;
    }
  | {
      type: "inbox_check";
      mailbox: string;
      action: "list" | "ack" | "search";
    }
  | {
      type: "broadcast";
      appName: string;
      title: string;
      eventId: number;
    };

type Listener = (event: MailboxEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribe(mailbox: string, listener: Listener): () => void {
  if (!listeners.has(mailbox)) {
    listeners.set(mailbox, new Set());
  }
  listeners.get(mailbox)!.add(listener);

  return () => {
    listeners.get(mailbox)?.delete(listener);
    if (listeners.get(mailbox)?.size === 0) {
      listeners.delete(mailbox);
    }
  };
}

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
