import { tickRecurring } from "@/lib/recurring";

const TICK_INTERVAL_MS = 60_000; // 1 minute

export default defineNitroPlugin((nitroApp) => {
  let timer: ReturnType<typeof setInterval> | undefined;

  // Start the scheduler after a short delay (let the server fully boot)
  setTimeout(() => {
    console.log("[recurring] Scheduler started — ticking every 60s");

    // Tick immediately on startup to catch any overdue templates
    tickRecurring()
      .then(({ created, errors }) => {
        if (created > 0 || errors > 0) {
          console.log(`[recurring] Startup tick: ${created} created, ${errors} errors`);
        }
      })
      .catch((err) => console.error("[recurring] Startup tick failed:", err));

    // Then tick every minute
    timer = setInterval(async () => {
      try {
        const { created, errors } = await tickRecurring();
        if (created > 0 || errors > 0) {
          console.log(`[recurring] Tick: ${created} created, ${errors} errors`);
        }
      } catch (err) {
        console.error("[recurring] Tick failed:", err);
      }
    }, TICK_INTERVAL_MS);
  }, 5000);

  // Cleanup on shutdown
  nitroApp.hooks.hook("close", () => {
    if (timer) {
      clearInterval(timer);
      console.log("[recurring] Scheduler stopped");
    }
  });
});
