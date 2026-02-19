import { sql } from "drizzle-orm";
import { defineEventHandler } from "h3";
import { db } from "@/db";
import { authenticateEvent } from "@/lib/auth";

interface ProbeResult {
  id: string;
  name: string;
  status: "pass" | "warn" | "fail";
  summary: string;
  details?: string;
  durationMs: number;
}

async function runProbe(
  id: string,
  name: string,
  fn: () => Promise<{
    status: "pass" | "warn" | "fail";
    summary: string;
    details?: string;
  }>,
): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const result = await fn();
    return { id, name, ...result, durationMs: Date.now() - start };
  } catch (err: any) {
    return {
      id,
      name,
      status: "fail",
      summary: err.message || "Unknown error",
      durationMs: Date.now() - start,
    };
  }
}

export default defineEventHandler(async (event) => {
  const start = Date.now();
  const auth = await authenticateEvent(event);

  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!auth.isAdmin) {
    return new Response(
      JSON.stringify({
        error: "Admin access required",
        hint: "This endpoint requires an admin token. Use /api/doctor for standard probes.",
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  const probes: ProbeResult[] = [];

  // Probe 7: Database
  probes.push(
    await runProbe("database", "Database", async () => {
      try {
        // Test connectivity
        const result = await db.execute(
          sql`SELECT current_database() as db, current_user as usr`,
        );
        const dbName = result[0]?.db;
        const dbUser = result[0]?.usr;

        // Check required tables exist
        const tables = await db.execute(sql`
          SELECT table_name FROM information_schema.tables 
          WHERE table_schema = 'public' 
          ORDER BY table_name
        `);
        const tableNames = tables.map((r: any) => r.table_name);
        const requiredTables = [
          "mailbox_tokens",
          "messages",
          "chat_channels",
          "chat_messages",
          "swarm_projects",
          "swarm_tasks",
        ];
        const missing = requiredTables.filter((t) => !tableNames.includes(t));

        if (missing.length > 0) {
          return {
            status: "warn",
            summary: `DB connected (${dbUser}@${dbName}), missing tables: ${missing.join(", ")}`,
            details: `Found ${tableNames.length} tables`,
          };
        }

        // Check grants
        const grants = await db.execute(sql`
          SELECT r.rolname FROM pg_roles r 
          JOIN pg_auth_members m ON m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
          WHERE r.oid = m.roleid
        `);
        const roles = grants.map((r: any) => r.rolname);

        return {
          status: "pass",
          summary: `DB OK: ${dbUser}@${dbName}, ${tableNames.length} tables, roles: [${roles.join(", ")}]`,
        };
      } catch (err: any) {
        return {
          status: "fail",
          summary: `DB connection failed: ${err.message}`,
        };
      }
    }),
  );

  // Probe 8: Infrastructure
  probes.push(
    await runProbe("infrastructure", "Infrastructure", async () => {
      const checks: string[] = [];
      const warnings: string[] = [];

      // Check step-ca cert
      try {
        const baseUrl = process.env.HIVE_BASE_URL || "http://localhost:3000";
        const resp = await fetch(`${baseUrl}/api/health`, {
          signal: AbortSignal.timeout(5000),
        });
        if (resp.ok) {
          checks.push("HTTPS self-check: OK");
        } else {
          warnings.push(`HTTPS self-check: ${resp.status}`);
        }
      } catch (err: any) {
        warnings.push(`HTTPS self-check failed: ${err.message}`);
      }

      // Check OneDev reachability
      try {
        const onedevUrl = process.env.ONEDEV_URL;
        if (!onedevUrl) throw new Error("ONEDEV_URL not configured");
        const resp = await fetch(`${onedevUrl}/~api/~version`, {
          signal: AbortSignal.timeout(5000),
        });
        checks.push(`OneDev: ${resp.ok ? "reachable" : `HTTP ${resp.status}`}`);
      } catch (err: any) {
        warnings.push(`OneDev unreachable: ${err.message}`);
      }

      if (warnings.length > 0) {
        return {
          status: "warn",
          summary: `${checks.length} passed, ${warnings.length} warnings`,
          details: [...checks, ...warnings].join("; "),
        };
      }
      return {
        status: "pass",
        summary: `All infra checks passed (${checks.length} checks)`,
        details: checks.join("; "),
      };
    }),
  );

  const statuses = probes.map((p) => p.status);
  const overallStatus = statuses.includes("fail")
    ? "fail"
    : statuses.includes("warn")
      ? "warn"
      : "pass";

  return {
    version: "1.0.0",
    ok: overallStatus === "pass",
    status: overallStatus,
    warnings: probes.filter((p) => p.status === "warn").map((p) => p.summary),
    errors: probes.filter((p) => p.status === "fail").map((p) => p.summary),
    probes,
    totalDurationMs: Date.now() - start,
  };
});
