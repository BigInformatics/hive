import { sql } from "drizzle-orm";
import { defineEventHandler, getHeader } from "h3";
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

  const probes: ProbeResult[] = [];

  // Probe 1: Environment
  probes.push(
    await runProbe("env", "Environment", async () => {
      const warnings: string[] = [];
      const errors: string[] = [];

      const required = ["PGHOST", "PGUSER", "PGPASSWORD"];
      const missing = required.filter(
        (k) => !process.env[k] && !process.env[`HIVE_${k}`],
      );
      if (missing.length > 0) {
        errors.push(`Missing required env vars: ${missing.join(", ")}`);
      }

      // Superuser config
      if (!process.env.SUPERUSER_NAME) {
        errors.push("SUPERUSER_NAME is not set — admin access unavailable");
      }
      const token = process.env.SUPERUSER_TOKEN || "";
      if (!token) {
        errors.push("SUPERUSER_TOKEN is not set — admin access unavailable");
      } else if (token === "change-me-to-a-long-random-secret") {
        errors.push(
          "SUPERUSER_TOKEN is still the default placeholder — change it to a long random secret before going further",
        );
      } else if (token.length < 24) {
        warnings.push(
          "SUPERUSER_TOKEN is short — use a token of at least 32 characters for security",
        );
      }

      // HIVE_BASE_URL
      const baseUrl = process.env.HIVE_BASE_URL || "";
      if (!baseUrl) {
        warnings.push(
          "HIVE_BASE_URL is not set — invite links and skill docs will use localhost; set this to your public URL for production",
        );
      } else if (
        baseUrl.includes("localhost") ||
        baseUrl.includes("127.0.0.1")
      ) {
        if (process.env.NODE_ENV === "production") {
          warnings.push(
            `HIVE_BASE_URL is set to ${baseUrl} but NODE_ENV=production — update to your public URL`,
          );
        }
      }

      if (errors.length > 0) {
        return {
          status: "fail",
          summary: errors[0],
          details: [...errors, ...warnings].join("\n"),
        };
      }
      if (warnings.length > 0) {
        return {
          status: "warn",
          summary: warnings[0],
          details: warnings.join("\n"),
        };
      }
      return { status: "pass", summary: "All required env vars present" };
    }),
  );

  // Probe 2: Connectivity (health check, self-test)
  probes.push(
    await runProbe("connectivity", "Connectivity", async () => {
      // Self-check: can we respond? (trivial but confirms server is up)
      return { status: "pass", summary: "Server responding" };
    }),
  );

  // Probe 3: Authentication
  probes.push(
    await runProbe("auth", "Authentication", async () => {
      // We already authenticated above, check Accept header gotcha
      const accept = getHeader(event, "accept") || "";
      const warnings: string[] = [];
      if (
        accept &&
        !accept.includes("application/json") &&
        !accept.includes("*/*")
      ) {
        warnings.push("Accept header may cause 406 errors with H3/Nitro");
      }
      return {
        status: "pass",
        summary: `Authenticated as ${auth.identity}${auth.isAdmin ? " (admin)" : ""}`,
        details: warnings.length > 0 ? warnings.join("; ") : undefined,
      };
    }),
  );

  // Probe 4: Identity & Presence
  probes.push(
    await runProbe("identity", "Identity & Presence", async () => {
      return {
        status: "pass",
        summary: `Identity: ${auth.identity}, admin: ${auth.isAdmin}`,
      };
    }),
  );

  // Probe 5: Chat channels
  probes.push(
    await runProbe("chat", "Chat Channels", async () => {
      try {
        const result = await db.execute(
          sql`SELECT COUNT(*) as count FROM chat_channels`,
        );
        const count = Number(result[0]?.count ?? 0);
        if (count === 0) {
          return { status: "warn", summary: "No chat channels found" };
        }
        return {
          status: "pass",
          summary: `${count} chat channel(s) available`,
        };
      } catch (err: any) {
        return { status: "fail", summary: `Chat query failed: ${err.message}` };
      }
    }),
  );

  // Probe 5b: Users table + user count
  probes.push(
    await runProbe("users", "Users", async () => {
      try {
        const result = await db.execute(
          sql`SELECT COUNT(*) as count FROM users`,
        );
        const count = Number(result[0]?.count ?? 0);
        if (count === 0) {
          return {
            status: "warn",
            summary:
              "No users found — create invites from /admin and have teammates register via /onboard?code=…",
          };
        }
        return { status: "pass", summary: `${count} user(s) registered` };
      } catch (err: any) {
        if (err.message?.includes("does not exist")) {
          return {
            status: "fail",
            summary:
              "users table missing — migrations may not have run. Check /api/health and server logs.",
          };
        }
        return {
          status: "fail",
          summary: `Users check failed: ${err.message}`,
        };
      }
    }),
  );

  // Probe 5c: Migration tracking
  probes.push(
    await runProbe("migrations", "Migrations", async () => {
      try {
        const result = await db.execute(
          sql`SELECT COUNT(*) as count FROM _hive_migrations`,
        );
        const appliedCount = Number(result[0]?.count ?? 0);
        if (appliedCount === 0) {
          return {
            status: "warn",
            summary:
              "Migration tracking table is empty — migrations may have run via db:push without being tracked. See /reference/migrations for backfill instructions.",
          };
        }
        return {
          status: "pass",
          summary: `${appliedCount} migration(s) tracked as applied`,
        };
      } catch {
        return {
          status: "warn",
          summary:
            "_hive_migrations table not found — migrations have not run yet",
        };
      }
    }),
  );

  // Probe 6: Webhooks
  probes.push(
    await runProbe("webhooks", "Webhooks", async () => {
      try {
        const result = await db.execute(
          sql`SELECT webhook_url FROM mailbox_tokens WHERE identity = ${auth?.identity} AND revoked_at IS NULL AND webhook_url IS NOT NULL LIMIT 1`,
        );
        if (!result[0]?.webhook_url) {
          return {
            status: "warn",
            summary: "No webhook URL registered — use POST /api/auth/webhook",
          };
        }
        return { status: "pass", summary: `Webhook: ${result[0].webhook_url}` };
      } catch (err: any) {
        // Table might not exist
        return {
          status: "warn",
          summary: `Webhook check skipped: ${err.message}`,
        };
      }
    }),
  );

  // Rollup
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
