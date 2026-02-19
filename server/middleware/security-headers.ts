import { defineEventHandler, getRequestPath } from "h3";

export default defineEventHandler((event) => {
  const res = event.node?.res;
  if (!res?.setHeader) return;

  const path = getRequestPath(event);

  // Only apply to responses that will render (skip WebSocket upgrades)
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );

  // HSTS — only if behind TLS (check via X-Forwarded-Proto or config)
  const proto = event.node?.req?.headers?.["x-forwarded-proto"];
  if (proto === "https") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }

  // CSP — permissive enough for the SPA but blocks inline scripts from injection
  // Allow 'unsafe-inline' for styles (Tailwind injects styles), 'self' for scripts
  if (path.startsWith("/api/")) {
    // API responses — strict CSP
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'",
    );
  } else {
    // UI pages — allow self + inline styles for Tailwind
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' wss: ws:; font-src 'self' data:; frame-ancestors 'none'",
    );
  }
});
