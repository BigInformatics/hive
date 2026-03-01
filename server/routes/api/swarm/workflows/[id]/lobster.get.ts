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

/** Private/internal IP ranges blocked to prevent SSRF */
const BLOCKED_HOSTS = /^(localhost|.*\.local)$/i;
const BLOCKED_PREFIXES = [
  "127.",
  "10.",
  "172.16.",
  "172.17.",
  "172.18.",
  "172.19.",
  "172.20.",
  "172.21.",
  "172.22.",
  "172.23.",
  "172.24.",
  "172.25.",
  "172.26.",
  "172.27.",
  "172.28.",
  "172.29.",
  "172.30.",
  "172.31.",
  "192.168.",
  "169.254.", // cloud metadata
  "::1",
  "fc",
  "fd",
];

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (BLOCKED_HOSTS.test(h)) return true;
  return BLOCKED_PREFIXES.some((p) => h.startsWith(p));
}

function safeDocumentUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Invalid documentUrl");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("documentUrl must use http or https");
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new Error("documentUrl targets a blocked/internal address");
  }
  return parsed;
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
        for (const line of step.description.split("\n")) {
          lines.push(`    # ${line}`);
        }
      }
      // Use explicit command if provided, otherwise echo the step title/id
      const cmd =
        step.command || `echo ${JSON.stringify(step.title || step.id)}`;
      // Always YAML-escape the command to handle shell special chars
      lines.push(`    command: ${yamlStr(cmd)}`);
      if (step.approval) {
        lines.push("    approval: required");
      }
      if (step.condition) {
        lines.push(`    condition: ${yamlStr(step.condition)}`);
      }
    }
  }

  return lines.join("\n") + "\n";
}

function yamlStr(s: string): string {
  // Quote if the string contains YAML-significant characters or whitespace
  if (/[:{}\[\],&*#?|<>=!%@`'"\\]/.test(s) || /\s/.test(s)) {
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
    let parsedUrl: URL;
    try {
      parsedUrl = safeDocumentUrl(wf.documentUrl);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Invalid documentUrl";
      return new Response(JSON.stringify({ error: msg }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const res = await fetch(parsedUrl.toString(), {
        signal: AbortSignal.timeout(8000),
        redirect: "manual", // don't follow redirects to other hosts
      });
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
