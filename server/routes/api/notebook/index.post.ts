import { defineEventHandler, readBody } from "h3";
import { authenticateEvent } from "@/lib/auth";
import { db } from "@/db";
import { notebookPages } from "@/db/schema";

export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await readBody(event);
  const { title, content, taggedUsers } = body ?? {};

  if (!title?.trim()) {
    return new Response(
      JSON.stringify({ error: "title is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const [page] = await db
    .insert(notebookPages)
    .values({
      title: String(title).slice(0, 255),
      content: content ? String(content) : "",
      createdBy: auth.identity,
      taggedUsers:
        Array.isArray(taggedUsers) && taggedUsers.length > 0
          ? taggedUsers.map(String)
          : null,
    })
    .returning();

  return { page };
});
