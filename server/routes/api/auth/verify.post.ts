import { defineEventHandler } from "h3";
import { authenticateEvent } from "@/lib/auth";

// Simple auth verification endpoint - no DB needed
export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Invalid key" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return { identity: auth.identity, isAdmin: auth.isAdmin };
});
