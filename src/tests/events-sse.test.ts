import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "../db/client";

// Ensure hive schema is applied (we only need hive_events)
async function ensureSchema() {
  await sql`CREATE TABLE IF NOT EXISTS public.hive_events (
    id BIGSERIAL PRIMARY KEY,
    type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload JSONB NOT NULL
  )`;
}

describe("hive events log", () => {
  beforeAll(async () => {
    await ensureSchema();
    await sql`TRUNCATE TABLE public.hive_events`;
  });

  afterAll(async () => {
    // leave table intact
  });

  test("can append and read events in order", async () => {
    const [a] = await sql`
      INSERT INTO public.hive_events (type, payload)
      VALUES ('test.one', '{"a":1}'::jsonb)
      RETURNING id
    `;
    const [b] = await sql`
      INSERT INTO public.hive_events (type, payload)
      VALUES ('test.two', '{"b":2}'::jsonb)
      RETURNING id
    `;

    const rows = await sql`
      SELECT id, type FROM public.hive_events
      WHERE id >= ${a.id}
      ORDER BY id ASC
    `;

    expect(rows.map((r: any) => r.type)).toEqual(["test.one", "test.two"]);
    expect(rows[0].id < rows[1].id).toBeTrue();
    expect(b.id > a.id).toBeTrue();
  });
});
