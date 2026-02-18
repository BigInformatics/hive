/**
 * Message lifecycle tests — send, read, ack.
 * Requires TEST_HIVE_URL and TEST_HIVE_TOKEN env vars.
 * The token identity will send a message to itself.
 */
import { describe, it, expect, beforeAll } from "vitest";

const BASE = process.env.TEST_HIVE_URL || "";
const TOKEN = process.env.TEST_HIVE_TOKEN || "";

const skip = !BASE || !TOKEN;

let identity = "";
let sentMessageId = "";

describe.skipIf(skip)("Messages API", () => {
  beforeAll(async () => {
    // Get our identity
    const res = await fetch(`${BASE}/api/auth/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const body = await res.json();
    identity = body.identity;
  });

  it("POST /api/mailboxes/:recipient/messages — send a message", async () => {
    const res = await fetch(`${BASE}/api/mailboxes/${identity}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Test message",
        body: "This is an automated test message.",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("id");
    sentMessageId = body.id;
  });

  it("GET /api/mailboxes/me/messages — list inbox", async () => {
    const res = await fetch(`${BASE}/api/mailboxes/me/messages?limit=5`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.messages)).toBe(true);
  });

  it("POST /api/mailboxes/me/messages/:id/ack — acknowledge message", async () => {
    if (!sentMessageId) return;
    const res = await fetch(`${BASE}/api/mailboxes/me/messages/${sentMessageId}/ack`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
  });

  it("POST /api/mailboxes/me/messages/ack — batch ack", async () => {
    const res = await fetch(`${BASE}/api/mailboxes/me/messages/ack`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids: [] }),
    });
    expect(res.status).toBe(200);
  });

  it("GET /api/mailboxes/me/messages/search — search messages", async () => {
    const res = await fetch(`${BASE}/api/mailboxes/me/messages/search?q=test`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect([200, 404]).toContain(res.status); // 404 if search not implemented
  });
});
