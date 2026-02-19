import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import {
  defineEventHandler,
  getRouterParam,
  sendStream,
  setResponseHeader,
} from "h3";

const AVATAR_DIR =
  process.env.AVATAR_DIR || join(process.cwd(), "public", "avatars");
const EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".svg"];

/**
 * GET /api/avatars/:identity
 * Serves the avatar image for a given identity, or 404.
 * Checks for files named <identity>.<ext> in AVATAR_DIR.
 */
export default defineEventHandler(async (event) => {
  const identity = getRouterParam(event, "identity")?.toLowerCase();
  if (!identity || !/^[a-z][a-z0-9_-]*$/.test(identity)) {
    return new Response("Not found", { status: 404 });
  }

  for (const ext of EXTENSIONS) {
    const filePath = join(AVATAR_DIR, `${identity}${ext}`);
    if (existsSync(filePath)) {
      const mimeMap: Record<string, string> = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
      };
      setResponseHeader(
        event,
        "Content-Type",
        mimeMap[ext] || "application/octet-stream",
      );
      setResponseHeader(event, "Cache-Control", "public, max-age=3600");
      return sendStream(event, createReadStream(filePath));
    }
  }

  return new Response("Not found", { status: 404 });
});
