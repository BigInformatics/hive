import { defineEventHandler, readBody } from "h3";
import { db } from "@/db";
import { directoryEntries } from "@/db/schema";
import { authenticateEvent } from "@/lib/auth";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await readBody(event);
  const { title, url, description, taggedUsers } = body ?? {};

  if (!title?.trim() || !url?.trim()) {
    return new Response(
      JSON.stringify({ error: "title and url are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const [entry] = await db
    .insert(directoryEntries)
    .values({
      title: String(title).slice(0, 255),
      url: String(url),
      description: description ? String(description) : null,
      createdBy: auth.identity,
      taggedUsers:
        Array.isArray(taggedUsers) && taggedUsers.length > 0
          ? taggedUsers.map(String)
          : null,
    })
    .returning();

  return entry;
});
