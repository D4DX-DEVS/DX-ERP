import { index, sqliteTable, uniqueIndex } from "drizzle-orm/sqlite-core";
import { bool, date, int, json, num, pk, ref, text, timestamps, type CommentEntry, type FileRef, type HistoryEntry, type Id } from "./_base";
import type { Priority } from "./project";

export interface TaskSubmission {
  _id?: Id;
  note: string;
  attachments: FileRef[];
  link?: string;
  submittedBy: Id;
  submittedByName: string;
  submittedAt: Date;
  reviewStatus: "pending" | "approved" | "changes_requested";
  reviewNote?: string;
  reviewedBy?: Id;
  reviewedByName?: string;
  reviewedAt?: Date;
  rating?: number;
}

/** Writes must trim `title`. Assignee / sharedWith membership is queried with `jsonHas(...)`. */
export const Task = sqliteTable(
  "tasks",
  {
    _id: pk(),
    taskNo: text().notNull(),
    project: ref(),
    milestone: ref(),
    parent: ref(),
    title: text().notNull(),
    description: text(),
    assignees: json<Id[]>()
      .notNull()
      .$defaultFn(() => []),
    /** Users who may see the task without being assignees (FRS §11.4 explicitly shared tasks). */
    sharedWith: json<Id[]>()
      .notNull()
      .$defaultFn(() => []),
    reporter: ref(),
    reviewer: ref(),
    priority: text().$type<Priority>().notNull().default("medium"),
    status: text().notNull(),
    startDate: text(),
    dueDate: text(),
    completedAt: date(),
    estimateHours: num().notNull().default(0),
    progress: num().notNull().default(0),
    dependencies: json<Id[]>()
      .notNull()
      .$defaultFn(() => []),
    blocker: text(),
    isLearning: bool().notNull().default(false),
    attachments: json<FileRef[]>()
      .notNull()
      .$defaultFn(() => []),
    comments: json<CommentEntry[]>()
      .notNull()
      .$defaultFn(() => []),
    submissions: json<TaskSubmission[]>()
      .notNull()
      .$defaultFn(() => []),
    history: json<HistoryEntry[]>()
      .notNull()
      .$defaultFn(() => []),
    deadlineNotifiedAt: date(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("tasks_task_no").on(t.taskNo),
    index("tasks_project").on(t.project),
    index("tasks_parent").on(t.parent),
    index("tasks_status").on(t.status),
    index("tasks_due_date").on(t.dueDate),
  ],
);
export type ITask = typeof Task.$inferSelect;

export type TimesheetStatus = "draft" | "submitted" | "approved" | "rejected";

export const TimesheetEntry = sqliteTable(
  "timesheetentries",
  {
    _id: pk(),
    user: ref().notNull(),
    date: text().notNull(),
    weekStart: text().notNull(),
    project: ref(),
    task: ref(),
    minutes: int().notNull(),
    description: text().notNull(),
    billable: bool().notNull().default(true),
    status: text().$type<TimesheetStatus>().notNull().default("draft"),
    submittedAt: date(),
    reviewer: ref(),
    reviewerName: text(),
    reviewedAt: date(),
    reviewNote: text(),
    history: json<HistoryEntry[]>()
      .notNull()
      .$defaultFn(() => []),
    ...timestamps(),
  },
  (t) => [
    index("timesheetentries_project").on(t.project),
    index("timesheetentries_task").on(t.task),
    index("timesheetentries_status").on(t.status),
    index("timesheetentries_user_week").on(t.user, t.weekStart),
    index("timesheetentries_user_date").on(t.user, t.date),
  ],
);
export type ITimesheetEntry = typeof TimesheetEntry.$inferSelect;

export type IssueStatus = "open" | "assigned" | "in_progress" | "fixed" | "ready_for_testing" | "reopened" | "verified" | "closed";
export const ISSUE_STATUSES: IssueStatus[] = ["open", "assigned", "in_progress", "fixed", "ready_for_testing", "reopened", "verified", "closed"];
export type IssueSeverity = "critical" | "major" | "minor" | "trivial";

/** Writes must trim `title`. */
export const Issue = sqliteTable(
  "issues",
  {
    _id: pk(),
    issueNo: text().notNull(),
    project: ref().notNull(),
    task: ref(),
    title: text().notNull(),
    description: text(),
    severity: text().$type<IssueSeverity>().notNull().default("minor"),
    priority: text().$type<Priority>().notNull().default("medium"),
    stepsToReproduce: text(),
    environment: text(),
    attachments: json<FileRef[]>()
      .notNull()
      .$defaultFn(() => []),
    assignee: ref(),
    team: text(),
    reporter: ref().notNull(),
    reportedDate: text().notNull(),
    targetDate: text(),
    status: text().$type<IssueStatus>().notNull().default("open"),
    resolution: text(),
    resolvedAt: date(),
    verifiedBy: ref(),
    closedAt: date(),
    reopenCount: int().notNull().default(0),
    comments: json<CommentEntry[]>()
      .notNull()
      .$defaultFn(() => []),
    history: json<HistoryEntry[]>()
      .notNull()
      .$defaultFn(() => []),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("issues_issue_no").on(t.issueNo),
    index("issues_project").on(t.project),
    index("issues_assignee").on(t.assignee),
    index("issues_status").on(t.status),
  ],
);
export type IIssue = typeof Issue.$inferSelect;
