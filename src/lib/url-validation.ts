/**
 * Validate a webhook URL to prevent SSRF attacks.
 * Blocks private IP ranges, localhost, and non-HTTP(S) schemes.
 */
export function validateWebhookUrl(urlStr: string): {
  valid: boolean;
  error?: string;
} {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  // Only allow http and https
  if (!["http:", "https:"].includes(url.protocol)) {
    return { valid: false, error: "Only http and https URLs are allowed" };
  }

  const hostname = url.hostname.toLowerCase();

  // Block localhost variants
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname === "0.0.0.0"
  ) {
    return { valid: false, error: "Localhost URLs are not allowed" };
  }

  // Block private IP ranges
  const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipMatch) {
    const [, a, b] = ipMatch.map(Number);
    if (a === 10)
      return { valid: false, error: "Private IP addresses are not allowed" };
    if (a === 172 && b >= 16 && b <= 31)
      return { valid: false, error: "Private IP addresses are not allowed" };
    if (a === 192 && b === 168)
      return { valid: false, error: "Private IP addresses are not allowed" };
    if (a === 169 && b === 254)
      return { valid: false, error: "Link-local addresses are not allowed" };
    if (a === 0) return { valid: false, error: "Invalid IP address" };
  }

  // Block metadata endpoints (cloud providers)
  if (
    hostname === "metadata.google.internal" ||
    hostname.endsWith(".internal")
  ) {
    return { valid: false, error: "Internal hostnames are not allowed" };
  }

  // Allow configurable bypass for known internal hosts
  const allowedInternalHosts = (process.env.HIVE_WEBHOOK_ALLOWED_HOSTS || "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  if (
    allowedInternalHosts.length > 0 &&
    allowedInternalHosts.includes(hostname)
  ) {
    return { valid: true };
  }

  return { valid: true };
}
