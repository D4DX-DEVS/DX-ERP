import "server-only";
import { and, asc, desc, eq, gte, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Project, ProjectChatRead, ProjectMessage, User, type Id, type IProjectMessage } from "@/lib/models";
import { inList } from "@/lib/sql";
import { projectCaps, projectMemberIds } from "@/lib/work-access";
import type { ChatMember, ChatMessageView } from "./chat-types";

/** Messages per page when the chat opens and per "Load earlier". */
export const CHAT_PAGE = 40;

type ChatProject = { _id: Id; projectNo: string; title: string; manager: Id | null; team: { user: Id }[] };

/**
 * The chat is open to everyone on the project — its manager and team members (QA engineers on the team too, though they
 * only see the overview otherwise) — and to people who see every project (the super admin).
 */
export function canChat(user: CurrentUser, project: { manager?: Id | null; team?: { user: Id }[] }): boolean {
  const caps = projectCaps(user, project);
  return caps.full || caps.isMember;
}

/** The project if it exists and the user may use its chat. */
export async function chatProject(user: CurrentUser, projectId: string): Promise<ChatProject | null> {
  const [project] = await db()
    .select({ _id: Project._id, projectNo: Project.projectNo, title: Project.title, manager: Project.manager, team: Project.team })
    .from(Project)
    .where(eq(Project._id, projectId))
    .limit(1);
  return project && canChat(user, project) ? project : null;
}

/** People who can be @mentioned: the manager, the team and the super admin. */
export async function chatMembers(project: { manager?: Id | null; team?: { user: Id }[] }): Promise<ChatMember[]> {
  const rows = await db()
    .select({ id: User._id, name: User.name, photo: User.photo })
    .from(User)
    .where(or(inList(User._id, projectMemberIds(project)), eq(User.isSuperAdmin, true)))
    .orderBy(asc(User.name));
  return rows.map((u) => ({ id: u.id, name: u.name, photo: u.photo ?? undefined }));
}

export function toView(m: IProjectMessage): ChatMessageView {
  return {
    id: m._id,
    userId: m.user,
    userName: m.userName,
    text: m.text ?? "",
    mentions: m.mentions,
    reply: m.replyTo ? { id: m.replyTo._id, userName: m.replyTo.userName, text: m.replyTo.text, voice: m.replyTo.voice } : undefined,
    voice: m.voice ? { url: `/api/files/${m.voice.file}`, seconds: m.voice.seconds } : undefined,
    at: m.createdAt.getTime(),
    updated: m.updatedAt.getTime(),
    deleted: Boolean(m.deletedAt),
  };
}

/** The latest page of messages (oldest first), or the page before `before` (ms); `more` = older ones exist. */
export async function chatPage(projectId: Id, before?: number): Promise<{ messages: ChatMessageView[]; more: boolean }> {
  const rows = await db()
    .select()
    .from(ProjectMessage)
    .where(and(eq(ProjectMessage.project, projectId), before ? lt(ProjectMessage.createdAt, new Date(before)) : undefined))
    .orderBy(desc(ProjectMessage.createdAt), desc(ProjectMessage._id))
    .limit(CHAT_PAGE + 1);
  return { messages: rows.slice(0, CHAT_PAGE).reverse().map(toView), more: rows.length > CHAT_PAGE };
}

/** Messages sent, or deleted, at or after `since` (ms) — what a polling client has not seen yet. */
export async function chatChanges(projectId: Id, since: number): Promise<ChatMessageView[]> {
  const rows = await db()
    .select()
    .from(ProjectMessage)
    .where(and(eq(ProjectMessage.project, projectId), gte(ProjectMessage.updatedAt, new Date(since))))
    .orderBy(asc(ProjectMessage.updatedAt))
    .limit(200);
  return rows.map(toView);
}

const readId = (projectId: Id, userId: Id) => `${projectId}:${userId}`;

/** Records that the user has read the chat up to `at` (never moves the mark back). */
export async function markChatRead(projectId: Id, userId: Id, at: Date): Promise<void> {
  await db()
    .insert(ProjectChatRead)
    .values({ _id: readId(projectId, userId), project: projectId, user: userId, lastReadAt: at })
    .onConflictDoUpdate({ target: ProjectChatRead._id, set: { lastReadAt: sql`max(${ProjectChatRead.lastReadAt}, ${at.getTime()})` } });
}

/** Messages from others the user has not read yet (for the Chat tab badge). */
export async function chatUnread(projectId: Id, userId: Id): Promise<number> {
  return db().$count(
    ProjectMessage,
    and(
      eq(ProjectMessage.project, projectId),
      ne(ProjectMessage.user, userId),
      isNull(ProjectMessage.deletedAt),
      sql`${ProjectMessage.createdAt} > coalesce((select ${ProjectChatRead.lastReadAt} from ${ProjectChatRead} where ${ProjectChatRead._id} = ${readId(projectId, userId)}), 0)`,
    ),
  );
}
