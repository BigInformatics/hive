/**
 * Escapes a string value for use in Prometheus label values.
 * 
 * Prometheus label values must escape: backslashes, newlines, and double quotes.
 * @see https://prometheus.io/docs/instrumenting/exposition_formats/#text-format-example
 */
export function escapePrometheusLabelValue(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll('"', '\\"');
}
