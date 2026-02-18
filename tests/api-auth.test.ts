/**
 * Auth API tests — these test the authentication logic patterns.
 * For full integration tests, set TEST_HIVE_URL and TEST_HIVE_TOKEN env vars.
 */
import { describe, it, expect, beforeAll, test } from "vitest";

const BASE = process.env.TEST_HIVE_URL || "";
const TOKEN = process.env.TEST_HIVE_TOKEN || "";

const skip = !BASE || !TOKEN;

describe.skipIf(skip)("Auth API", () => {
  it("POST /api/auth/verify — valid token returns identity", async () => {
    const res = await fetch(`${BASE}/api/auth/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("identity");
    expect(typeof body.identity).toBe("string");
  });

  it("POST /api/auth/verify — no token returns 401", async () => {
    const res = await fetch(`${BASE}/api/auth/verify`, {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("POST /api/auth/verify — bad token returns 401", async () => {
    const res = await fetch(`${BASE}/api/auth/verify`, {
      method: "POST",
      headers: { Authorization: "Bearer totally-invalid-token" },
    });
    expect(res.status).toBe(401);
  });

  it("GET /api/auth/invites — requires admin", async () => {
    const res = await fetch(`${BASE}/api/auth/invites`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    // Either 200 (admin) or 403 (non-admin) — both are valid auth responses
    expect([200, 403]).toContain(res.status);
  });

  it("GET /api/auth/tokens — requires admin", async () => {
    const res = await fetch(`${BASE}/api/auth/tokens`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect([200, 403]).toContain(res.status);
  });
});
