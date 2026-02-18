import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env" });
config({ path: "/etc/clawdbot/vault.env" });

const host = process.env.PGHOST_DATA || process.env.PGHOST || "localhost";
const port = process.env.PGPORT || "5432";
const user = process.env.PGUSER || "postgres";
const password = process.env.PGPASSWORD || "";
const database =
  process.env.PGDATABASE_TEAM || process.env.PGDATABASE || "postgres";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`,
  },
});
