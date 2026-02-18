import { useEffect, useRef } from "react";
import { getMailboxKey } from "./api";

export type ChatSSEEvent =
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
    };

export function useChatSSE(onEvent: (evt: ChatSSEEvent) => void) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const token = getMailboxKey();
    if (!token) return;

    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout>;

    const connect = () => {
      es = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);

      const handler = (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          onEventRef.current(data);
        } catch {}
      };

      es.addEventListener("chat_message", handler);
      es.addEventListener("chat_typing", handler);

      es.onerror = () => {
        es?.close();
        retryTimeout = setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      es?.close();
      clearTimeout(retryTimeout);
    };
  }, []);
}
