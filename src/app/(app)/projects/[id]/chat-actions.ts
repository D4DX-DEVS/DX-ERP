"use server";

import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { ActionError, actionUser, parse, runAction, type ActionResult } from "@/lib/actions";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ProjectMessage, StoredFile, type ChatReplyRef, type ChatVoice } from "@/lib/models";
import { notifyMany, type NotifyItem } from "@/lib/notify";
import { AUDIO_MIME } from "@/lib/storage";
import { zs } from "@/lib/validation";
import { chatMembers, chatProject, markChatRead, toView } from "./chat-data";
import { VOICE_MAX_SECONDS, type ChatMessageView } from "./chat-types";

const sendSchema = z.object({
  text: zs.optText(4000),
  replyTo: zs.optId(),
  mentions: zs.ids(),
  voice: zs.optId(),
  seconds: zs.optNum({ min: 0, max: VOICE_MAX_SECONDS + 5 }),
});

async function loadProject(user: CurrentUser, projectId: string) {
  const project = await chatProject(user, projectId);
  if (!project) throw new ActionError("You don't have access to this project's chat.");
  return project;
}

function snippet(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Posts a message (text and/or a voice note, optionally replying to another); notifies the people mentioned and the one replied to. */
export async function sendChatMessage(projectId: string, input: Record<string, unknown>): Promise<ActionResult<ChatMessageView>> {
  return runAction(async () => {
    const user = await actionUser();
    const data = parse(sendSchema, input);
    const project = await loadProject(user, projectId);
    if (!data.text && !data.voice) throw new ActionError("Type a message or record a voice message.");

    const [file, target, members] = await Promise.all([
      data.voice ? db().select().from(StoredFile).where(eq(StoredFile._id, data.voice)).limit(1).then((r) => r[0]) : undefined,
      data.replyTo
        ? db()
            .select()
            .from(ProjectMessage)
            .where(and(eq(ProjectMessage._id, data.replyTo), eq(ProjectMessage.project, projectId)))
            .limit(1)
            .then((r) => r[0])
        : undefined,
      chatMembers(project),
    ]);

    let voice: ChatVoice | null = null;
    if (data.voice) {
      // Only an audio file this person just uploaded to this project.
      if (!file || file.deletedAt || file.entityType !== "project" || file.entityId !== projectId || file.uploadedBy !== user.id || !AUDIO_MIME.has(file.mime)) {
        throw new ActionError("The voice message was not found. Please record it again.");
      }
      voice = { file: file._id, size: file.size, mime: file.mime, seconds: Math.round(data.seconds ?? 0) };
    }
    const replyTo: ChatReplyRef | null =
      target && !target.deletedAt ? { _id: target._id, user: target.user, userName: target.userName, text: target.text ? snippet(target.text, 200) : undefined, voice: target.voice ? true : undefined } : null;

    const memberIds = new Set(members.map((m) => m.id));
    const mentions = [...new Set(data.mentions)].filter((id) => id !== user.id && memberIds.has(id));
    const [row] = await db()
      .insert(ProjectMessage)
      .values({ project: projectId, user: user._id, userName: user.name, text: data.text ?? null, mentions, replyTo, voice })
      .returning();

    const body = data.text ? snippet(data.text) : "Voice message";
    const link = `/projects/${projectId}?tab=chat`;
    const items: NotifyItem[] = [];
    if (mentions.length) items.push({ recipients: mentions, input: { type: "project", title: `${user.name} mentioned you in ${project.projectNo} chat`, body, link }, exclude: [user._id] });
    if (replyTo && replyTo.user !== user.id && !mentions.includes(replyTo.user) && memberIds.has(replyTo.user)) {
      items.push({ recipients: [replyTo.user], input: { type: "project", title: `${user.name} replied to you in ${project.projectNo} chat`, body, link }, exclude: [user._id] });
    }
    await Promise.all([items.length ? notifyMany(items) : undefined, markChatRead(projectId, user._id, row.createdAt)]);
    return toView(row);
  });
}

/** Deletes a message (the author, or the super admin): its text and voice note go, a "deleted" stub stays in the thread. */
export async function deleteChatMessage(projectId: string, messageId: string): Promise<ActionResult<ChatMessageView>> {
  return runAction(async () => {
    const user = await actionUser();
    await loadProject(user, projectId);
    const [message] = await db()
      .select({ user: ProjectMessage.user, voice: ProjectMessage.voice, deletedAt: ProjectMessage.deletedAt })
      .from(ProjectMessage)
      .where(and(eq(ProjectMessage._id, messageId), eq(ProjectMessage.project, projectId)))
      .limit(1);
    if (!message || message.deletedAt) throw new ActionError("This message was already deleted.");
    if (message.user !== user.id && !user.isSuperAdmin) throw new ActionError("You can only delete your own messages.");
    const [row] = await db()
      .update(ProjectMessage)
      .set({ text: null, voice: null, mentions: [], deletedAt: new Date() })
      .where(and(eq(ProjectMessage._id, messageId), isNull(ProjectMessage.deletedAt)))
      .returning();
    if (!row) throw new ActionError("This message was already deleted.");
    if (message.voice) await db().update(StoredFile).set({ deletedAt: new Date() }).where(eq(StoredFile._id, message.voice.file));
    return toView(row);
  }, "Message deleted");
}
