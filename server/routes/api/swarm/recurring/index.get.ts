import { defineEventHandler, getQuery } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { listRecurringTemplates } from "@/lib/recurring";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const query = getQuery(event);
  const includeDisabled = query.includeDisabled === "true";
  const templates = await listRecurringTemplates(includeDisabled);

  return { templates };
});
