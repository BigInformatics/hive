import { defineEventHandler } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { tickRecurring } from "@/lib/recurring";

export default defineEventHandler(async (event) => {
  const auth = authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await tickRecurring();
  return result;
});
