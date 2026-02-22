import { defineEventHandler } from "h3";
import { startMigrations } from "@/lib/migrate";
import { startScheduler } from "@/lib/scheduler";

// Run any pending DB migrations and start the scheduler on first server request
startMigrations();
startScheduler();

export default defineEventHandler(() => {
  return { status: "ok", timestamp: new Date().toISOString() };
});
