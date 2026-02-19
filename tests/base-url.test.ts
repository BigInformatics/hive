import { afterEach, describe, expect, it } from "vitest";

describe("getBaseUrl", () => {
  const original = process.env.HIVE_BASE_URL;

  afterEach(() => {
    if (original !== undefined) {
      process.env.HIVE_BASE_URL = original;
    } else {
      delete process.env.HIVE_BASE_URL;
    }
    // Clear module cache so it re-reads env
    vi.resetModules();
  });

  it("returns HIVE_BASE_URL when set", async () => {
    process.env.HIVE_BASE_URL = "https://my-hive.example.com";
    const { getBaseUrl } = await import("@/lib/base-url");
    expect(getBaseUrl()).toBe("https://my-hive.example.com");
  });

  it("strips trailing slashes", async () => {
    process.env.HIVE_BASE_URL = "https://my-hive.example.com///";
    const { getBaseUrl } = await import("@/lib/base-url");
    expect(getBaseUrl()).toBe("https://my-hive.example.com");
  });

  it("defaults to localhost:3000", async () => {
    delete process.env.HIVE_BASE_URL;
    const { getBaseUrl } = await import("@/lib/base-url");
    expect(getBaseUrl()).toBe("http://localhost:3000");
  });
});
