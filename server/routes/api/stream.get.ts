import { defineEventHandler, getQuery } from "h3";
import { authenticateTokenAsync } from "@/lib/auth";
import { subscribe } from "@/lib/events";
import { updatePresence } from "@/lib/presence";
import { getWakeItems, markBuzzEventsDelivered } from "@/lib/wake";

export default defineEventHandler(async (event) => {
  // Auth via query param (SSE can't set headers)
  const query = getQuery(event);
  const token = query.token as string;
  if (!token) {
    return new Response(JSON.stringify({ error: "token required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const auth = await authenticateTokenAsync(token);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  updatePresence(auth.identity, "sse");

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      let wakePulseTimer: ReturnType<typeof setInterval> | undefined;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        unsub();
        unsubBroadcast();
        unsubSwarm();
        unsubChat();
        unsubWake();
        clearInterval(heartbeat);
        if (wakePulseTimer) clearInterval(wakePulseTimer);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      };

      const send = (eventType: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        } catch {
          cleanup();
        }
      };

      // Send initial ping
      send("connected", { identity: auth.identity });

      // Subscribe to mailbox events
      const unsub = subscribe(auth.identity, (evt) => {
        send(evt.type, evt);
      });

      // Subscribe to broadcast events (global channel)
      const unsubBroadcast = subscribe("__broadcast__", (evt) => {
        send("broadcast", evt);
      });

      // Subscribe to swarm events (global channel)
      const unsubSwarm = subscribe("__swarm__", (evt) => {
        send(evt.type, evt);
      });

      // Subscribe to chat events (global channel for typing — messages go via per-identity)
      const unsubChat = subscribe("__chat__", (evt) => {
        send(evt.type, evt);
      });

      // Subscribe to wake pulse triggers (immediate pulse on new wake events)
      const unsubWake = subscribe("__wake__", (evt) => {
        if (evt.type === "wake_pulse" && evt.identity === auth.identity) {
          sendWakePulse();
        }
      });

      // Wake pulse helper
      const sendWakePulse = async () => {
        if (closed) return;
        try {
          const payload = await getWakeItems(auth.identity);
          if (payload.items.length > 0) {
            await markBuzzEventsDelivered(payload.items);
          }
          send("wake_pulse", payload);
        } catch (err) {
          console.error("[sse] Wake pulse error:", err);
        }
      };

      // Heartbeat every 30s
      const heartbeat = setInterval(() => {
        if (closed) {
          clearInterval(heartbeat);
          return;
        }
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
          updatePresence(auth.identity, "sse");
        } catch {
          cleanup();
        }
      }, 30000);

      // Wake pulse every 30 minutes
      const WAKE_PULSE_INTERVAL = 30 * 60 * 1000;
      wakePulseTimer = setInterval(() => {
        if (closed) {
          clearInterval(wakePulseTimer);
          return;
        }
        sendWakePulse();
      }, WAKE_PULSE_INTERVAL);

      // Cleanup on close — works in both Node and Bun
      if (event.node?.req?.on) {
        event.node.req.on("close", cleanup);
      }
      // Also use AbortSignal if available (Bun)
      if (event.node?.req?.signal) {
        (event.node.req as any).signal.addEventListener("abort", cleanup);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
