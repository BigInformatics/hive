import { useEffect, useRef } from "react";
import { getMailboxKey } from "./api";

type SwarmEvent = {
  type: "swarm_task_created" | "swarm_task_updated" | "swarm_task_deleted";
  taskId: string;
  title?: string;
  status?: string;
  previousStatus?: string;
  actor?: string;
};

export function useSwarmSSE(onEvent: (evt: SwarmEvent) => void) {
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

      es.addEventListener("swarm_task_created", handler);
      es.addEventListener("swarm_task_updated", handler);
      es.addEventListener("swarm_task_deleted", handler);

      es.onerror = () => {
        es?.close();
        // Reconnect after 5s
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
