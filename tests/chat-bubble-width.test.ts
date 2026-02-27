/**
 * Regression tests for chat bubble width calc class.
 *
 * The chat bubble uses a Tailwind arbitrary value for max-width:
 *   max-w-[calc(75%_-_1.5rem)]
 *
 * In Tailwind CSS, underscore (_) in arbitrary values represents a space.
 * So this produces CSS: max-width: calc(75% - 1.5rem);
 *
 * This test ensures the calc syntax doesn't regress (e.g., malformed values
 * that could break mobile layout or overflow behavior).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Chat bubble width calc class", () => {
  it("presence.tsx contains the correct max-w calc class for message bubbles", () => {
    const filePath = join(import.meta.dirname, "../src/routes/presence.tsx");
    const source = readFileSync(filePath, "utf-8");

    // The expected Tailwind arbitrary value for calc(75% - 1.5rem)
    // Using Tailwind's underscore-to-space escaping
    const expectedClass = "max-w-[calc(75%_-_1.5rem)]";
    expect(source).toContain(expectedClass);
  });

  it("the calc value uses correct Tailwind arbitrary value syntax", () => {
    const filePath = join(import.meta.dirname, "../src/routes/presence.tsx");
    const source = readFileSync(filePath, "utf-8");

    // Pattern: max-w-[calc(DD%_-_X.Xrem)]
    // - DD = percentage (digits)
    // - X.X = rem value (with decimal)
    // - __- = " - " (escaped space, minus, escaped space)
    const calcPattern = /max-w-\[calc\(\d+%_-_[\d.]+rem\)\]/;
    expect(source).toMatch(calcPattern);
  });

  it("message bubbles have max-width constraint (prevent full-width overflow)", () => {
    const filePath = join(import.meta.dirname, "../src/routes/presence.tsx");
    const source = readFileSync(filePath, "utf-8");

    // Ensure max-width class is present on message bubbles
    // This prevents messages from expanding to full width on mobile
    expect(source).toMatch(/max-w-\[calc/);
  });

  it("verifies the percentage value is 75% (leaves room for avatar + margin)", () => {
    const filePath = join(import.meta.dirname, "../src/routes/presence.tsx");
    const source = readFileSync(filePath, "utf-8");

    // 75% leaves ~25% for avatar (2.5rem ≈ 40px) and margin
    // This is important for mobile view where space is limited
    const match = source.match(/max-w-\[calc\((\d+)%_-_([\d.]+)rem\)\]/);
    expect(match).not.toBeNull();

    const percentage = match ? parseInt(match[1], 10) : 0;
    expect(percentage).toBe(75);
  });
});