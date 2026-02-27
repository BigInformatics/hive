/**
 * Unit tests for Prometheus label value escaping.
 * Validates that escapePrometheusLabelValue properly handles special characters
 * that would break Prometheus text exposition format.
 */
import { describe, expect, it } from "vitest";

/**
 * Escape a value for use in a Prometheus label.
 * Backslashes, newlines, and double quotes must be escaped.
 */
function escapePrometheusLabelValue(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll('"', '\\"');
}

describe("escapePrometheusLabelValue", () => {
  it("returns simple strings unchanged", () => {
    expect(escapePrometheusLabelValue("normal")).toBe("normal");
    expect(escapePrometheusLabelValue("v1.2.3")).toBe("v1.2.3");
    expect(escapePrometheusLabelValue("ready")).toBe("ready");
  });

  it("escapes backslashes", () => {
    expect(escapePrometheusLabelValue("path\\to\\file")).toBe(
      "path\\\\to\\\\file",
    );
    expect(escapePrometheusLabelValue("\\")).toBe("\\\\");
  });

  it("escapes double quotes", () => {
    expect(escapePrometheusLabelValue('say "hello"')).toBe('say \\"hello\\"');
    expect(escapePrometheusLabelValue('"')).toBe('\\"');
  });

  it("escapes newlines", () => {
    expect(escapePrometheusLabelValue("line1\nline2")).toBe("line1\\nline2");
    expect(escapePrometheusLabelValue("\n")).toBe("\\n");
    expect(escapePrometheusLabelValue("before\nafter")).toBe("before\\nafter");
  });

  it("escapes multiple newlines", () => {
    expect(escapePrometheusLabelValue("a\nb\nc")).toBe("a\\nb\\nc");
  });

  it("handles combinations of special characters", () => {
    // Backslash + quote
    expect(escapePrometheusLabelValue('path\\ "name"')).toBe(
      'path\\\\ \\"name\\"',
    );

    // Newline + quote
    expect(escapePrometheusLabelValue('line1\n"quoted"')).toBe(
      'line1\\n\\"quoted\\"',
    );

    // All three
    expect(escapePrometheusLabelValue('\\\n"')).toBe('\\\\\\n\\"');
  });

  it("handles user-provided status values", () => {
    // Realistic test: status might contain user input
    expect(escapePrometheusLabelValue("in_progress")).toBe("in_progress");
    expect(escapePrometheusLabelValue('status: "ready"')).toBe(
      'status: \\"ready\\"',
    );
    expect(escapePrometheusLabelValue("error: path\\not\\found")).toBe(
      "error: path\\\\not\\\\found",
    );
  });

  it("handles version strings with special chars", () => {
    // Version typically safe, but test edge cases
    expect(escapePrometheusLabelValue("v1.0.0")).toBe("v1.0.0");
    expect(escapePrometheusLabelValue("v1.0.0-beta\\1")).toBe("v1.0.0-beta\\\\1");
  });

  it("produces valid Prometheus label syntax", () => {
    // The escaped result should be safe to embed in a Prometheus metric line
    const escaped = escapePrometheusLabelValue('a"b\\c\nd');
    // Simulate a metric line with the escaped value
    const line = `hive_test{value="${escaped}"} 1`;

    // Verify the escaped value can be safely embedded in Prometheus format
    // The escaped version should not contain raw newlines (would break parsing)
    expect(escaped).not.toContain("\n");
    // Raw quotes inside should be escaped, not raw
    expect(escaped).toContain('\\"');
    // Backslashes should be doubled
    expect(escaped).toContain("\\\\");
    // Line should start/end correctly for Prometheus format
    expect(line).toMatch(/^hive_test\{value=".*"\} 1$/);
  });

  it("handles empty string", () => {
    expect(escapePrometheusLabelValue("")).toBe("");
  });

  it("handles unicode and special chars that don't need escaping", () => {
    expect(escapePrometheusLabelValue("café")).toBe("café");
    expect(escapePrometheusLabelValue("emoji 🚀")).toBe("emoji 🚀");
    expect(escapePrometheusLabelValue("tabs\tand\ncr")).toBe(
      "tabs\tand\\ncr",
    );
  });
});