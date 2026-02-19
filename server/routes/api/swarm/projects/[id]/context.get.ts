import { eq, inArray } from "drizzle-orm";
import { defineEventHandler, getRouterParam } from "h3";
import { db } from "@/db";
import {
  chatMembers,
  chatMessages,
  contentProjectTags,
  directoryEntries,
  mailboxMessages,
  notebookPages,
  swarmProjects,
  swarmTasks,
} from "@/db/schema";
import { authenticateEvent } from "@/lib/auth";

/**
 * GET /api/swarm/projects/:id/context
 * Pull all Hive content related to a project for the authenticated user.
 * Returns an organized document respecting user visibility.
 */
export default defineEventHandler(async (event) => {
  const auth = await authenticateEvent(event);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const projectId = getRouterParam(event, "id");
  if (!projectId) {
    return new Response(JSON.stringify({ error: "Project id required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verify project exists
  const [project] = await db
    .select()
    .from(swarmProjects)
    .where(eq(swarmProjects.id, projectId))
    .limit(1);

  if (!project) {
    return new Response(JSON.stringify({ error: "Project not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Get all tags for this project
  const tags = await db
    .select()
    .from(contentProjectTags)
    .where(eq(contentProjectTags.projectId, projectId));

  // Group tag content IDs by type
  const idsByType: Record<string, string[]> = {};
  for (const tag of tags) {
    if (!idsByType[tag.contentType]) idsByType[tag.contentType] = [];
    idsByType[tag.contentType].push(tag.contentId);
  }

  // Fetch tasks directly linked to this project (always included)
  const tasks = await db
    .select()
    .from(swarmTasks)
    .where(eq(swarmTasks.projectId, projectId));

  // Fetch tagged mailbox messages (only if user is sender or recipient)
  let messages: (typeof mailboxMessages.$inferSelect)[] = [];
  if (idsByType.message?.length) {
    const allMessages = await db
      .select()
      .from(mailboxMessages)
      .where(
        inArray(
          mailboxMessages.id,
          idsByType.message.map((id) => Number(id)),
        ),
      );
    messages = allMessages.filter(
      (m) => m.sender === auth.identity || m.recipient === auth.identity,
    );
  }

  // Fetch tagged chat messages (only from channels the user is a member of)
  let chatMsgs: (typeof chatMessages.$inferSelect)[] = [];
  if (idsByType.chat_message?.length) {
    // Get channels user is a member of
    const memberships = await db
      .select({ channelId: chatMembers.channelId })
      .from(chatMembers)
      .where(eq(chatMembers.identity, auth.identity));
    const memberChannelIds = new Set(memberships.map((m) => m.channelId));

    const allChatMsgs = await db
      .select()
      .from(chatMessages)
      .where(
        inArray(
          chatMessages.id,
          idsByType.chat_message.map((id) => Number(id)),
        ),
      );
    chatMsgs = allChatMsgs.filter((m) => memberChannelIds.has(m.channelId));
  }

  // Fetch tagged notebook pages (visible to all authenticated users)
  let pages: (typeof notebookPages.$inferSelect)[] = [];
  if (idsByType.notebook_page?.length) {
    pages = await db
      .select()
      .from(notebookPages)
      .where(inArray(notebookPages.id, idsByType.notebook_page));
  }

  // Fetch tagged directory links (visible to all authenticated users)
  let links: (typeof directoryEntries.$inferSelect)[] = [];
  if (idsByType.directory_link?.length) {
    links = await db
      .select()
      .from(directoryEntries)
      .where(
        inArray(
          directoryEntries.id,
          idsByType.directory_link.map((id) => Number(id)),
        ),
      );
  }

  return {
    project: {
      id: project.id,
      title: project.title,
      description: project.description,
      color: project.color,
      websiteUrl: project.websiteUrl,
      onedevUrl: project.onedevUrl,
      githubUrl: project.githubUrl,
    },
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      assignee: t.assigneeUserId,
      detail: t.detail,
      followUp: t.followUp,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
    taggedContent: {
      messages: messages.map((m) => ({
        id: m.id,
        title: m.title,
        body: m.body,
        sender: m.sender,
        recipient: m.recipient,
        createdAt: m.createdAt,
      })),
      chatMessages: chatMsgs.map((m) => ({
        id: m.id,
        channelId: m.channelId,
        sender: m.sender,
        body: m.body,
        createdAt: m.createdAt,
      })),
      notebookPages: pages.map((p) => ({
        id: p.id,
        title: p.title,
        content: p.content,
        createdBy: p.createdBy,
        tags: p.tags,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
      directoryLinks: links.map((l) => ({
        id: l.id,
        title: l.title,
        url: l.url,
        description: l.description,
        createdBy: l.createdBy,
        createdAt: l.createdAt,
      })),
    },
    totalTaggedItems: tags.length,
  };
});
