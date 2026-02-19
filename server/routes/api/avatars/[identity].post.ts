import { defineEventHandler, getRouterParam, readMultipartFormData } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { join } from "node:path";
import { writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";

const AVATAR_DIR = process.env.AVATAR_DIR || join(process.cwd(), "public", "avatars");
const MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * POST /api/avatars/:identity
 * Upload an avatar for an identity. Requires admin auth.
 * Accepts multipart form data with a single file field named "avatar".
 */
export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth?.isAdmin) {
    return new Response(JSON.stringify({ error: "Admin required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const identity = getRouterParam(event, "identity")?.toLowerCase();
  if (!identity || !/^[a-z][a-z0-9_-]*$/.test(identity)) {
    return new Response(JSON.stringify({ error: "Invalid identity" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parts = await readMultipartFormData(event);
  const file = parts?.find((p) => p.name === "avatar");

  if (!file || !file.data || !file.type) {
    return new Response(JSON.stringify({ error: "No avatar file provided" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return new Response(JSON.stringify({ error: "Only JPEG, PNG, and WebP are allowed" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (file.data.length > MAX_SIZE) {
    return new Response(JSON.stringify({ error: "File too large (max 2MB)" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const extMap: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
  };
  const ext = extMap[file.type] || ".jpg";
  const filename = `${identity}${ext}`;

  mkdirSync(AVATAR_DIR, { recursive: true });

  // Remove any existing avatar files for this identity to prevent stale format conflicts
  try {
    for (const f of readdirSync(AVATAR_DIR)) {
      if (f.startsWith(`${identity}.`) && f !== filename) {
        unlinkSync(join(AVATAR_DIR, f));
      }
    }
  } catch {}

  writeFileSync(join(AVATAR_DIR, filename), file.data);

  return {
    identity,
    avatar: `/api/avatars/${identity}`,
    message: `Avatar uploaded for ${identity}`,
  };
});
