import { defineEventHandler, getRequestURL, sendRedirect } from "h3";

// Legacy alias: redirect /api/skill/broadcast → /api/skill/buzz
export default defineEventHandler((event) => {
  const url = getRequestURL(event);
  const newPath = url.pathname.replace(/\/broadcast$/, "/buzz");
  return sendRedirect(event, newPath + (url.search || ""), 307);
});