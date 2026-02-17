import { tickRecurring } from "./recurring";

const TICK_INTERVAL_MS = 60_000; // 1 minute
let started = false;

/** Call once to start the recurring task scheduler. Safe to call multiple times. */
export function startScheduler() {
  if (started) return;
  started = true;

  console.log("[scheduler] Starting recurring tick (every 60s)");

  // Tick immediately to catch overdue templates
  tickRecurring()
    .then(({ created, errors }) => {
      if (created > 0 || errors > 0) {
        console.log(`[scheduler] Startup tick: ${created} created, ${errors} errors`);
      }
    })
    .catch((err) => console.error("[scheduler] Startup tick failed:", err));

  // Then every minute
  setInterval(async () => {
    try {
      const { created, errors } = await tickRecurring();
      if (created > 0 || errors > 0) {
        console.log(`[scheduler] Tick: ${created} created, ${errors} errors`);
      }
    } catch (err) {
      console.error("[scheduler] Tick failed:", err);
    }
  }, TICK_INTERVAL_MS);
}
