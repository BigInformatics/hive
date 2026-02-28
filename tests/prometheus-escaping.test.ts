import { describe, expect, it } from "vitest";
import { escapePrometheusLabelValue } from "../src/lib/prometheus";

describe("escapePrometheusLabelValue", () => {
  it("should return unchanged string with no special characters", () => {
    expect(escapePrometheusLabelValue("normal-value")).toBe("normal-value");
  });

  it("should escape backslashes", () => {
    expect(escapePrometheusLabelValue("path\\to\\file")).toBe(
      "path\\\\to\\\\file",
    );
  });

  it("should escape double quotes", () => {
    expect(escapePrometheusLabelValue('say "hello"')).toBe('say \\"hello\\"');
  });

  it("should escape newlines", () => {
    expect(escapePrometheusLabelValue("line1\nline2")).toBe("line1\\nline2");
  });

  it("should handle multiple escape sequences in one string", () => {
    const input = 'path\\to\\"file"\nline2';
    const expected = 'path\\\\to\\\\\\"file\\"\\nline2';
    expect(escapePrometheusLabelValue(input)).toBe(expected);
  });

  it("should produce escaped output safe for Prometheus format", () => {
    // The escaped output should contain literal \n, \", and \\
    // (the characters that Prometheus expects as escape sequences)
    const input = 'status with "quotes" and\\backslash\nnewline';
    const escaped = escapePrometheusLabelValue(input);

    // Should contain the Prometheus escape sequences literally
    expect(escaped).toContain("\\n"); // literal backslash-n
    expect(escaped).toContain('\\"'); // literal backslash-quote
    expect(escaped).toContain("\\\\"); // literal double-backslash

    // Should NOT contain raw special characters
    expect(escaped).not.toMatch(/\n/); // no actual newline
  });

  it("should handle empty string", () => {
    expect(escapePrometheusLabelValue("")).toBe("");
  });

  it("should handle status values that might come from task statuses", () => {
    const statuses = ["ready", "in_progress", "complete", "holding", "queued"];
    for (const status of statuses) {
      const escaped = escapePrometheusLabelValue(status);
      expect(escaped).toBe(status); // Normal statuses don't need escaping
    }
  });

  it("should escape a string with only a backslash", () => {
    expect(escapePrometheusLabelValue("\\")).toBe("\\\\");
  });

  it("should escape a string with only a quote", () => {
    expect(escapePrometheusLabelValue('"')).toBe('\\"');
  });

  it("should escape a string with only a newline", () => {
    expect(escapePrometheusLabelValue("\n")).toBe("\\n");
  });
});
