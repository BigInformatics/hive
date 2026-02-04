import { sql } from "./client";

export interface HiveEvent {
  id: bigint;
  type: string;
  createdAt: Date;
  payload: unknown;
}

export async function appendEvent(type: string, payload: unknown): Promise<HiveEvent> {
  const [row] = await sql`
    INSERT INTO public.hive_events (type, payload)
    VALUES (${type}, ${JSON.stringify(payload)})
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
