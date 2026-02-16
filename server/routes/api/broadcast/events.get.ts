import { defineEventHandler, getQuery } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { listEvents } from "@/lib/broadcast";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const query = getQuery(event);
  const events = await listEvents({
    appName: query.appName as string | undefined,
    forUser: auth.identity,
    limit: query.limit ? Number(query.limit) : undefined,
  });

  return { events };
});
