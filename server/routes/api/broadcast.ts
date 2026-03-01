import { defineEventHandler, getRequestURL, sendRedirect } from "h3";

export default defineEventHandler((event) => {
  const url = getRequestURL(event);
  // Redirect /api/broadcast/* to /api/buzz/* (all methods, preserving query params)
  // Use 307 to preserve HTTP method (POST/PUT/DELETE stay as-is, not converted to GET)
  const newPath = url.pathname.replace(/^\/api\/broadcast/, "/api/buzz");
  return sendRedirect(event, newPath + (url.search || ""), 307);
});
