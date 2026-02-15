import { defineEventHandler, readBody } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { createRecurringTemplate } from "@/lib/recurring";

export default defineEventHandler(async (event) => {
  const auth = authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await readBody(event);
  if (!body?.title || !body?.cronExpr) {
    return new Response(
      JSON.stringify({ error: "title and cronExpr are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const template = await createRecurringTemplate({
    projectId: body.projectId,
    title: body.title,
    detail: body.detail,
    assigneeUserId: body.assigneeUserId,
    creatorUserId: auth.identity,
    cronExpr: body.cronExpr,
    timezone: body.timezone,
    initialStatus: body.initialStatus,
  });

  return template;
});
