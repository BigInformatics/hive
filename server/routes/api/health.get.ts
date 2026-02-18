import { defineEventHandler } from "h3";
import { startScheduler } from "@/lib/scheduler";

// Start the recurring scheduler on first server request
startScheduler();

export default defineEventHandler(() => {
  return { status: "ok", timestamp: new Date().toISOString() };
});
