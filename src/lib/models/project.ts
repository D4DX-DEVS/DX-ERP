import { index, sqliteTable, uniqueIndex } from "drizzle-orm/sqlite-core";
import { bool, json, num, pk, ref, text, timestamps, type CommentEntry, type FileRef, type HistoryEntry, type Id } from "./_base";

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
