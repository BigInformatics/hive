import { sql } from "drizzle-orm";
import { defineEventHandler, setResponseHeader } from "h3";
import { db } from "@/db";
import { getAppVersion } from "@/lib/app-version";
import { escapePrometheusLabelValue } from "@/lib/prometheus";

/**
 * Prometheus-compatible metrics endpoint
 * Returns metrics in Prometheus text exposition format
 */
export default defineEventHandler(async (event) => {
  const start = Date.now();

  // Query all metrics in parallel
  const [
    usersCount,
    chatChannelsCount,
    chatMessagesCount,
    mailboxMessagesCount,
    swarmProjectsCount,
    swarmTasksByStatus,
  ] = await Promise.all([
    // Users
    db.execute<{ count: string }>(sql`SELECT COUNT(*) as count FROM users`),
    // Chat channels
    db.execute<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM chat_channels`,
    ),
    // Chat messages
    db.execute<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM chat_messages`,
    ),
    // Mailbox messages
    db.execute<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM mailbox_messages`,
    ),
    // Swarm projects (non-archived)
    db.execute<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM swarm_projects WHERE archived_at IS NULL`,
    ),
    // Swarm tasks by status
    db.execute<{ status: string; count: string }>(
      sql`SELECT status, COUNT(*) as count FROM swarm_tasks GROUP BY status`,
    ),
  ]);

  const scrapeDurationMs = Date.now() - start;
  const version = getAppVersion();

  // Build Prometheus text output
  const lines: string[] = [];

  // Hive info metric (gauge with version label)
  lines.push("# HELP hive_info Hive application information");
  lines.push("# TYPE hive_info gauge");
  lines.push(`hive_info{version="${escapePrometheusLabelValue(version)}"} 1`);

  // Users
  lines.push("");
  lines.push("# HELP hive_users_total Total number of registered users");
  lines.push("# TYPE hive_users_total gauge");
  lines.push(`hive_users_total ${Number(usersCount[0]?.count ?? 0)}`);

  // Chat channels
  lines.push("");
  lines.push("# HELP hive_chat_channels_total Total number of chat channels");
  lines.push("# TYPE hive_chat_channels_total gauge");
  lines.push(
    `hive_chat_channels_total ${Number(chatChannelsCount[0]?.count ?? 0)}`,
  );

  // Chat messages
  lines.push("");
  lines.push("# HELP hive_chat_messages_total Total number of chat messages");
  lines.push("# TYPE hive_chat_messages_total gauge");
  lines.push(
    `hive_chat_messages_total ${Number(chatMessagesCount[0]?.count ?? 0)}`,
  );

  // Mailbox messages
  lines.push("");
  lines.push(
    "# HELP hive_mailbox_messages_total Total number of mailbox messages",
  );
  lines.push("# TYPE hive_mailbox_messages_total gauge");
  lines.push(
    `hive_mailbox_messages_total ${Number(mailboxMessagesCount[0]?.count ?? 0)}`,
  );

  // Swarm projects
  lines.push("");
  lines.push(
    "# HELP hive_swarm_projects_total Number of active swarm projects",
  );
  lines.push("# TYPE hive_swarm_projects_total gauge");
  lines.push(
    `hive_swarm_projects_total ${Number(swarmProjectsCount[0]?.count ?? 0)}`,
  );

  // Swarm tasks by status
  lines.push("");
  lines.push("# HELP hive_swarm_tasks_total Number of swarm tasks by status");
  lines.push("# TYPE hive_swarm_tasks_total gauge");
  for (const row of swarmTasksByStatus) {
    const status = row.status || "unknown";
    const count = Number(row.count ?? 0);
    lines.push(
      `hive_swarm_tasks_total{status="${escapePrometheusLabelValue(status)}"} ${count}`,
    );
  }

  // Scrape duration
  lines.push("");
  lines.push(
    "# HELP hive_metrics_scrape_duration_ms Time in milliseconds to collect metrics",
  );
  lines.push("# TYPE hive_metrics_scrape_duration_ms gauge");
  lines.push(`hive_metrics_scrape_duration_ms ${scrapeDurationMs}`);

  // Set content type for Prometheus
  setResponseHeader(event, "Content-Type", "text/plain; version=0.0.4");

  return lines.join("\n");
});
