import { defineEventHandler, readBody } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { createProject } from "@/lib/swarm";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await readBody(event);
  if (!body?.title || !body?.color) {
    return new Response(
      JSON.stringify({ error: "title and color are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const project = await createProject({
    title: body.title,
    description: body.description,
    color: body.color,
    projectLeadUserId: body.projectLeadUserId || auth.identity,
    developerLeadUserId: body.developerLeadUserId || auth.identity,
    websiteUrl: body.websiteUrl,
    onedevUrl: body.onedevUrl,
    githubUrl: body.githubUrl,
    dokployDeployUrl: body.dokployDeployUrl,
  });

  return project;
});
