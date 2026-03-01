import { defineEventHandler, getRequestURL, sendRedirect } from "h3";

export default defineEventHandler((event) => {
  const url = getRequestURL(event);
  // Redirect /api/skill/broadcast to /api/skill/buzz for backwards compatibility
  return sendRedirect(event, "/api/skill/buzz" + (url.search || ""), 307);
});
