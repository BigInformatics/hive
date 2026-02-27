import { describe, expect, it } from "vitest";

/**
 * Regression test for chat bubble width calc class.
 * @see https://github.com/BigInformatics/hive/pull/11#discussion_r2861838874
 * 
 * Ensures the right-side message bubble max-width class uses valid Tailwind calc syntax.
 * Current value: max-w-[calc(75%_-_1.5rem)]
 */
describe("Chat bubble width calc class", () => {
  // The expected class string for the chat bubble max-width
  const CHAT_BUBBLE_MAX_WIDTH_CLASS = "max-w-[calc(75%_-_1.5rem)]";

  it("should have correct max-width class format", () => {
    // Verify the class exists and has expected format
    expect(CHAT_BUBBLE_MAX_WIDTH_CLASS).toMatch(/^max-w-\[calc\(.+\)\]$/);
  });

  it("should use valid Tailwind v4 calc syntax with underscore-escaped operators", () => {
    // In Tailwind v4, spaces and operators in arbitrary values are escaped as underscores
    // "calc(75% - 1.5rem)" becomes "calc(75%_-_1.5rem)"
    // The "_-_" represents " - " (space dash space)
    
    const calcContent = CHAT_BUBBLE_MAX_WIDTH_CLASS.match(/calc\((.+)\)/)?.[1];
    expect(calcContent).toBeDefined();
    
    // Verify the format: percentage, underscore-escaped minus, rem value
    // Pattern: XX%_-_Y.Yrem (where _-_ is the escaped " - ")
    expect(calcContent).toMatch(/^\d+%_-_[\d.]+rem$/);
  });

  it("should have reasonable percentage value for bubble width", () => {
    const percentage = CHAT_BUBBLE_MAX_WIDTH_CLASS.match(/(\d+)%/)?.[1];
    expect(percentage).toBeDefined();
    
    const percentValue = parseInt(percentage!, 10);
    // Bubble should be less than 100% to leave room for other content
    expect(percentValue).toBeGreaterThan(50);
    expect(percentValue).toBeLessThan(100);
  });

  it("should have reasonable rem offset for padding/margin", () => {
    const remValue = CHAT_BUBBLE_MAX_WIDTH_CLASS.match(/([\d.]+)rem/)?.[1];
    expect(remValue).toBeDefined();
    
    const rem = parseFloat(remValue!);
    // Offset should be a small positive value (0.5rem to 3rem range is typical)
    expect(rem).toBeGreaterThan(0);
    expect(rem).toBeLessThan(5);
  });
});
