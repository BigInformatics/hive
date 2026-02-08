// Admin-managed user accounts with API tokens
import { sql } from "./client";
import { randomBytes } from "crypto";

export interface HiveUser {
  id: number;
  name: string;
  token: string;
  isAdmin: boolean;
  enabled: boolean;
  createdAt: Date;
}

// Auto-create table on first use
let tableEnsured = false;
async function ensureTable() {
  if (tableEnsured) return;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS public.hive_users (
        id BIGSERIAL PRIMARY KEY,
        name VARCHAR(50) NOT NULL UNIQUE,
        token CHAR(64) NOT NULL UNIQUE,
        is_admin BOOLEAN NOT NULL DEFAULT false,
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT valid_user_name CHECK (name ~ '^[a-z][a-z0-9_-]*$')
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_hive_users_token
        ON public.hive_users (token) WHERE enabled = true
    `;
    tableEnsured = true;
    console.log("[users] hive_users table ensured");
  } catch (err) {
    console.error("[users] Failed to ensure table:", err);
  }
}

function generateToken(): string {
  return randomBytes(32).toString("hex"); // 64-char hex
}

function mapUser(row: any): HiveUser {
  return {
    id: row.id,
    name: row.name,
    token: row.token,
    isAdmin: row.is_admin,
    enabled: row.enabled,
    createdAt: row.created_at,
  };
}

// Create a new user — returns full token (shown once)
export async function createUser(params: {
  name: string;
  isAdmin?: boolean;
}): Promise<HiveUser> {
  await ensureTable();
  const token = generateToken();

  const [row] = await sql`
    INSERT INTO public.hive_users (name, token, is_admin)
    VALUES (${params.name}, ${token}, ${params.isAdmin || false})
    RETURNING *
  `;

  return mapUser(row);
}

// List all users — tokens masked to last 4 chars
export async function listUsers(): Promise<HiveUser[]> {
  await ensureTable();
  const rows = await sql`SELECT * FROM public.hive_users ORDER BY created_at DESC`;
  return rows.map((row: any) => {
    const user = mapUser(row);
    user.token = "****" + user.token.slice(-4);
    return user;
  });
}

// Get user by ID — full token included
export async function getUserById(id: number): Promise<HiveUser | null> {
  await ensureTable();
  const [row] = await sql`SELECT * FROM public.hive_users WHERE id = ${id}`;
  return row ? mapUser(row) : null;
}

// Enable/disable user
export async function setUserEnabled(id: number, enabled: boolean): Promise<HiveUser | null> {
  await ensureTable();
  const [row] = await sql`
    UPDATE public.hive_users
    SET enabled = ${enabled}
    WHERE id = ${id}
    RETURNING *
  `;
  return row ? mapUser(row) : null;
}

// Delete user
export async function deleteUser(id: number): Promise<boolean> {
  await ensureTable();
  const result = await sql`DELETE FROM public.hive_users WHERE id = ${id}`;
  return result.count > 0;
}

// Load all enabled users as auth token configs (same format as auth.ts)
export async function loadUserTokens(): Promise<Record<string, { identity: string; admin?: boolean }>> {
  await ensureTable();
  const rows = await sql`SELECT * FROM public.hive_users WHERE enabled = true`;
  const config: Record<string, { identity: string; admin?: boolean }> = {};
  for (const row of rows) {
    config[row.token as string] = {
      identity: row.name as string,
      admin: (row.is_admin as boolean) || false,
    };
  }
  return config;
}
