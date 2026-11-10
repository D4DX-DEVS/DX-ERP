import { index, sqliteTable, uniqueIndex } from "drizzle-orm/sqlite-core";
import { bool, date, json, num, pk, ref, text, timestamps, type CommentEntry, type FileRef, type HistoryEntry, type Id } from "./_base";

export type Priority = "low" | "medium" | "high" | "urgent";
export const PRIORITIES: Priority[] = ["low", "medium", "high", "urgent"];

export interface Milestone {
  _id: Id;
  title: string;
  description?: string;
  dueDate?: string;
  status: "pending" | "in_progress" | "client_review" | "approved" | "delivered" | "delayed";
  deliveredAt?: string;
  clientReviewNote?: string;
  approvedBy?: string;
  approvedAt?: Date;
  releaseNotes?: string;
  /** Billing amount tied to this milestone (from the proposal's payment schedule). */
  amount?: number;
  invoiced?: boolean;
  invoice?: Id;
}

export interface TeamMember {
  _id?: Id;
  user: Id;
  role?: string;
  allocation: number;
}

export type ProjectLinkKind = "repository" | "live" | "staging" | "backend" | "admin" | "design" | "docs" | "other";
export const PROJECT_LINK_KINDS: ProjectLinkKind[] = ["repository", "live", "staging", "backend", "admin", "design", "docs", "other"];

/** A URL related to the project: code repository, live site, API base URL, design file, … (http/https only). */
export interface ProjectLink {
  _id: Id;
  kind: ProjectLinkKind;
  label?: string;
  url: string;
  addedBy?: Id;
  addedAt?: Date;
}

/** Writes must trim `title`. Team membership is queried with `jsonHasField(Project.team, "user", id)`. */
export const Project = sqliteTable(
  "projects",
  {
    _id: pk(),
    projectNo: text().notNull(),
    title: text().notNull(),
    client: ref(),
    internal: bool().notNull().default(false),
    description: text(),
    scope: text(),
    deliverables: json<string[]>()
      .notNull()
      .$defaultFn(() => []),
    manager: ref(),
    team: json<TeamMember[]>()
      .notNull()
      .$defaultFn(() => []),
    startDate: text(),
    targetDate: text(),
    completedDate: text(),
    budget: num().notNull().default(0),
    estimatedHours: num().notNull().default(0),
    priority: text().$type<Priority>().notNull().default("medium"),
    status: text().notNull(),
    proposal: ref(),
    contract: ref(),
    milestones: json<Milestone[]>()
      .notNull()
      .$defaultFn(() => []),
    tags: json<string[]>()
      .notNull()
      .$defaultFn(() => []),
    attachments: json<FileRef[]>()
      .notNull()
      .$defaultFn(() => []),
    links: json<ProjectLink[]>()
      .notNull()
      .$defaultFn(() => []),
    comments: json<CommentEntry[]>()
      .notNull()
      .$defaultFn(() => []),
    history: json<HistoryEntry[]>()
      .notNull()
      .$defaultFn(() => []),
    createdBy: ref(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("projects_project_no").on(t.projectNo),
    index("projects_client").on(t.client),
    index("projects_manager").on(t.manager),
    index("projects_status").on(t.status),
  ],
);
export type IProject = typeof Project.$inferSelect;

/** The message a chat message replies to, copied when sent so the quote survives the original being deleted. */
export interface ChatReplyRef {
  _id: Id;
  user: Id;
  userName: string;
  text?: string;
  voice?: boolean;
}

/** A voice note on a chat message; the audio is a StoredFile of the project (entityType "project"). */
export interface ChatVoice {
  file: Id;
  size: number;
  mime: string;
  seconds: number;
}

/**
 * Project chat: the project manager, team members and the super admin talk about the project. Writes must trim `text`.
 * A deleted message keeps its row (text and voice cleared, `deletedAt` set) so replies to it and polling clients see it go.
 */
export const ProjectMessage = sqliteTable(
  "project_messages",
  {
    _id: pk(),
    project: ref().notNull(),
    user: ref().notNull(),
    userName: text().notNull(),
    text: text(),
    /** People @mentioned in the text (notified). */
    mentions: json<Id[]>()
      .notNull()
      .$defaultFn(() => []),
    replyTo: json<ChatReplyRef>(),
    voice: json<ChatVoice>(),
    deletedAt: date(),
    ...timestamps(),
  },
  (t) => [index("project_messages_project_created").on(t.project, t.createdAt), index("project_messages_project_updated").on(t.project, t.updatedAt)],
);
export type IProjectMessage = typeof ProjectMessage.$inferSelect;

/** How far each person has read a project's chat (`_id` = "<project>:<user>"), for the unread count on the Chat tab. */
export const ProjectChatRead = sqliteTable("project_chat_reads", {
  _id: text().primaryKey(),
  project: ref().notNull(),
  user: ref().notNull(),
  lastReadAt: date().notNull(),
});
