/**
 * Returns the configured Hive base URL (no trailing slash).
 * Set via HIVE_BASE_URL env var; defaults to "http://localhost:3000" for local dev.
 */
export function getBaseUrl(): string {
  return (process.env.HIVE_BASE_URL || "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
}
