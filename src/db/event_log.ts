import { sql } from "./client";

export interface HiveEvent {
  id: bigint;
  type: string;
  createdAt: Date;
  payload: unknown;
}

// Ensure table exists on module load
let tableEnsured = false;
async function ensureTable() {
  if (tableEnsured) return;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS public.hive_events (
        id BIGSERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        payload JSONB NOT NULL
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_hive_events_created
        ON public.hive_events (created_at DESC)
    `;
    tableEnsured = true;
    console.log("[event_log] hive_events table ensured");
  } catch (err) {
    console.error("[event_log] Failed to ensure table:", err);
  }
}

export async function appendEvent(type: string, payload: unknown): Promise<HiveEvent> {
  await ensureTable();
  const [row] = await sql`
    INSERT INTO public.hive_events (type, payload)
    VALUES (${type}, ${sql.json(payload)})
    RETURNING *
  `;

  return {
    id: row.id as bigint,
    type: row.type as string,
    createdAt: row.created_at as Date,
    payload: row.payload as unknown,
  };
}

export async function listEventsSince(
  sinceId: bigint,
  limit: number
): Promise<HiveEvent[]> {
  await ensureTable();
  const rows = await sql`
    SELECT * FROM public.hive_events
    WHERE id > ${sinceId}
    ORDER BY id ASC
    LIMIT ${limit}
  `;

  return rows.map((row: any) => ({
    id: row.id as bigint,
    type: row.type as string,
    createdAt: row.created_at as Date,
    payload: row.payload as unknown,
  }));
}
