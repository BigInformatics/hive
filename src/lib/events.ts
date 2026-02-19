// Simple pub-sub for real-time events

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
    }
  | {
      type: "swarm_task_created";
      taskId: string;
      title: string;
      status: string;
      actor: string;
    }
  | {
      type: "swarm_task_updated";
      taskId: string;
      title: string;
      status: string;
      previousStatus?: string;
      actor: string;
    }
  | {
      type: "swarm_task_deleted";
      taskId: string;
      actor: string;
    }
  | {
      type: "chat_message";
      channelId: string;
      message: {
        id: number;
        sender: string;
        body: string;
        createdAt: string;
      };
    }
  | {
      type: "chat_typing";
      channelId: string;
      identity: string;
    }
  | {
      type: "wake_pulse";
      identity: string;
    };

type Listener = (event: MailboxEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribe(mailbox: string, listener: Listener): () => void {
  if (!listeners.has(mailbox)) {
    listeners.set(mailbox, new Set());
  }
  listeners.get(mailbox)?.add(listener);

  return () => {
    listeners.get(mailbox)?.delete(listener);
    if (listeners.get(mailbox)?.size === 0) {
      listeners.delete(mailbox);
    }
  };
}

/** Emit a wake pulse trigger for an identity (triggers immediate SSE pulse) */
export function emitWakeTrigger(identity: string): void {
  emit("__wake__", { type: "wake_pulse", identity });
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
