import { defineEventHandler, readBody, getRouterParam } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { updateProject } from "@/lib/swarm";

export default defineEventHandler(async (event) => {
  const auth = authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const id = getRouterParam(event, "id");
  if (!id) {
    return new Response(JSON.stringify({ error: "Missing project id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await readBody(event);
  const project = await updateProject(id, {
    title: body.title,
    description: body.description,
    color: body.color,
    projectLeadUserId: body.projectLeadUserId,
    developerLeadUserId: body.developerLeadUserId,
    websiteUrl: body.websiteUrl,
    onedevUrl: body.onedevUrl,
    githubUrl: body.githubUrl,
    dokployDeployUrl: body.dokployDeployUrl,
    workHoursStart: body.workHoursStart,
    workHoursEnd: body.workHoursEnd,
    workHoursTimezone: body.workHoursTimezone,
    blockingMode: body.blockingMode,
  });

  if (!project) {
    return new Response(JSON.stringify({ error: "Project not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return project;
});
