/**
 * GET /api/swarm/workflows/:id/lobster
 *
 * Exports a Cambigo workflow document as a Lobster-compatible YAML file.
 * Agents can call this endpoint to obtain the raw .lobster file for a workflow.
 *
 * If the workflow uses documentUrl (external), the Cambigo document is fetched
 * from the URL at request time. If it uses the inline document field, that is used.
 *
 * Response: text/plain (.lobster YAML) or 404 if not found / no document available.
 */

import { defineEventHandler, getRouterParam } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { getWorkflow } from "@/lib/workflow";

interface CambigoStep {
  id: string;
  title?: string;
  role?: string;
  description?: string;
  command?: string;
  approval?: boolean;
  condition?: string;
  next?: string | null;
}

interface CambigoFlow {
  name?: string;
  version?: string;
  steps?: CambigoStep[];
  args?: Record<string, { default?: unknown; description?: string }>;
}

function cambigoToLobster(flow: CambigoFlow, title: string): string {
  const name = flow.name || title;
  const steps = flow.steps || [];

  const lines: string[] = [];
  lines.push(`name: ${yamlStr(name)}`);

  if (flow.args && Object.keys(flow.args).length > 0) {
    lines.push("args:");
    for (const [key, def] of Object.entries(flow.args)) {
      lines.push(`  ${key}:`);
      if (def.default !== undefined) {
        lines.push(`    default: ${yamlStr(String(def.default))}`);
      }
      if (def.description) {
        lines.push(`    description: ${yamlStr(def.description)}`);
      }
    }
  }

  if (steps.length > 0) {
    lines.push("steps:");
    for (const step of steps) {
      lines.push(`  - id: ${yamlStr(step.id)}`);
      if (step.title) lines.push(`    # ${step.title}`);
      if (step.role) lines.push(`    # role: ${step.role}`);
      if (step.description) {
        // Multi-line description as a comment
        for (const line of step.description.split("\n")) {
          lines.push(`    # ${line}`);
        }
      }
      // Use explicit command if provided, otherwise echo the step title/description
      const cmd = step.command ||
        `echo ${JSON.stringify(step.title || step.id)}`;
      lines.push(`    command: ${cmd}`);
      if (step.approval) {
        lines.push("    approval: required");
      }
      if (step.condition) {
        lines.push(`    condition: ${step.condition}`);
      }
    }
  }

  return lines.join("\n") + "\n";
}

function yamlStr(s: string): string {
  // Quote if contains special chars
  if (/[:{}\[\],&*#?|<>=!%@`'"\\]/.test(s) || s.includes("\n")) {
    return JSON.stringify(s);
  }
  return s;
}

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const id = getRouterParam(event, "id");
  if (!id) {
    return new Response(JSON.stringify({ error: "id is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const wf = await getWorkflow(id, auth.identity);
  if (!wf) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  let flow: CambigoFlow | null = null;

  // Prefer inline document; fall back to fetching documentUrl
  if (wf.document && typeof wf.document === "object") {
    flow = wf.document as CambigoFlow;
  } else if (wf.documentUrl) {
    try {
      const res = await fetch(wf.documentUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      flow = JSON.parse(text) as CambigoFlow;
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch document from documentUrl" }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }
  } else {
    return new Response(
      JSON.stringify({ error: "Workflow has no document or documentUrl" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  const lobster = cambigoToLobster(flow, wf.title);
  const filename = (wf.title || "workflow")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return new Response(lobster, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `inline; filename="${filename}.lobster"`,
    },
  });
});
