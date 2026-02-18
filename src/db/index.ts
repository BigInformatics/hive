import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

config({ path: ".env" });
config({ path: "/etc/clawdbot/vault.env" });

// HIVE_PGHOST takes priority, then DATABASE_URL, then PGHOST, then default
const host = process.env.HIVE_PGHOST || process.env.PGHOST || "localhost";
const port = Number(process.env.PGPORT || 5432);
const user = process.env.PGUSER || "postgres";
const password = process.env.PGPASSWORD || "";
const database = process.env.PGDATABASE_TEAM || process.env.PGDATABASE || "postgres";

console.log(`[db] Connecting to ${user}@${host}:${port}/${database}`);

const client = postgres({ host, port, user, password, database });
export const db = drizzle(client, { schema });
