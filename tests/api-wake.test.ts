/**
 * Wake API tests — validates the wake endpoint contract.
 * Requires TEST_HIVE_URL and TEST_HIVE_TOKEN env vars.
 */
import { describe, expect, it } from "vitest";

const BASE = process.env.TEST_HIVE_URL || "";
const TOKEN = process.env.TEST_HIVE_TOKEN || "";

const skip = !BASE || !TOKEN;

describe.skipIf(skip)("Wake API", () => {
  it("GET /api/wake — returns valid wake payload", async () => {
    const res = await fetch(`${BASE}/api/wake`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    // Mandatory fields
    expect(body).toHaveProperty("instructions");
    expect(body).toHaveProperty("skill_url");
    expect(body).toHaveProperty("items");
    expect(body).toHaveProperty("actions");
    expect(body).toHaveProperty("timestamp");
    expect(Array.isArray(body.items)).toBe(true);
    expect(Array.isArray(body.actions)).toBe(true);

    // Every action must have item, action, skill_url
    for (const action of body.actions) {
      expect(action).toHaveProperty("item");
      expect(action).toHaveProperty("action");
      expect(action).toHaveProperty("skill_url");
      expect(typeof action.skill_url).toBe("string");
    }

    // Every item must have required fields
    for (const item of body.items) {
      expect(item).toHaveProperty("source");
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("summary");
      expect(item).toHaveProperty("priority");
      expect(item).toHaveProperty("ephemeral");
      expect([
        "message",
        "message_pending",
        "swarm",
        "buzz",
        "backup",
      ]).toContain(item.source);
      expect(["low", "normal", "high"]).toContain(item.priority);
    }
  });

  it("GET /api/wake — unauthenticated returns 401", async () => {
    const res = await fetch(`${BASE}/api/wake`);
    expect(res.status).toBe(401);
  });

  it("GET /api/wake — timestamp is valid ISO-8601", async () => {
    const res = await fetch(`${BASE}/api/wake`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const body = await res.json();
    const ts = new Date(body.timestamp);
    expect(ts.getTime()).not.toBeNaN();
    // Should be recent (within last 5 minutes)
    expect(Date.now() - ts.getTime()).toBeLessThan(5 * 60 * 1000);
  });
});
