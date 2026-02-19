import { createError, defineEventHandler, getMethod, getRequestPath } from "h3";

const _MAX_TITLE = 255;
const _MAX_BODY = 10_000;
const _MAX_CONTENT = 100_000; // notebook pages can be longer
const MAX_JSON_SIZE = 50_000; // 50KB general limit

export default defineEventHandler(async (event) => {
  const path = getRequestPath(event);
  const method = getMethod(event);

  // Only validate POST/PATCH/PUT with JSON bodies on API routes
  if (!path.startsWith("/api/")) return;
  if (!["POST", "PATCH", "PUT"].includes(method)) return;

  // Skip WebSocket upgrade
  if (path.includes("/ws")) return;

  // Read and validate body size
  const contentLength = parseInt(
    event.node?.req?.headers?.["content-length"] || "0",
    10,
  );
  if (contentLength > MAX_JSON_SIZE) {
    throw createError({
      statusCode: 413,
      statusMessage: "Payload Too Large",
      message: `Request body exceeds ${MAX_JSON_SIZE} bytes`,
    });
  }
});
