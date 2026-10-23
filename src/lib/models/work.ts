import {
  CommentSchema,
  defineModel,
  FileRefSchema,
  HistorySchema,
  ObjectIdType,
  Schema,
  type CommentEntry,
  type FileRef,
  type HistoryEntry,
  type ObjectId,
} from "./_base";
import type { Priority } from "./project";

export interface TaskSubmission {
  _id?: ObjectId;
  note: string;
  attachments: FileRef[];
  link?: string;
  submittedBy: ObjectId;
  submittedByName: string;
  submittedAt: Date;
  reviewStatus: "pending" | "approved" | "changes_requested";
  reviewNote?: string;
  reviewedBy?: ObjectId;
  reviewedByName?: string;
  reviewedAt?: Date;
  rating?: number;
}

export interface ITask {
  _id: ObjectId;
  taskNo: string;
  project?: ObjectId;
  milestone?: ObjectId;
  parent?: ObjectId;
  title: string;
  description?: string;
  assignees: ObjectId[];
  /** Users who may see the task without being assignees (FRS §11.4 explicitly shared tasks). */
  sharedWith: ObjectId[];
  reporter?: ObjectId;
  reviewer?: ObjectId;
  priority: Priority;
  status: string;
  startDate?: string;
  dueDate?: string;
  completedAt?: Date;
  estimateHours: number;
  progress: number;
  dependencies: ObjectId[];
  blocker?: string;
  isLearning: boolean;
  attachments: FileRef[];
  comments: CommentEntry[];
  submissions: TaskSubmission[];
  history: HistoryEntry[];
  deadlineNotifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SubmissionSchema = new Schema<TaskSubmission>({
  note: { type: String, required: true, maxlength: 5000 },
  attachments: { type: [FileRefSchema], default: [] },
  link: String,
  submittedBy: { type: ObjectIdType, ref: "User", required: true },
  submittedByName: String,
  submittedAt: { type: Date, default: Date.now },
  reviewStatus: { type: String, enum: ["pending", "approved", "changes_requested"], default: "pending" },
  reviewNote: String,
  reviewedBy: { type: ObjectIdType, ref: "User" },
  reviewedByName: String,
  reviewedAt: Date,
  rating: { type: Number, min: 1, max: 5 },
});

const TaskSchema = new Schema<ITask>(
  {
    taskNo: { type: String, required: true, unique: true },
    project: { type: ObjectIdType, ref: "Project", index: true },
    milestone: { type: ObjectIdType },
    parent: { type: ObjectIdType, ref: "Task", index: true },
    title: { type: String, required: true, trim: true, maxlength: 300 },
    description: { type: String, maxlength: 20000 },
    assignees: { type: [{ type: ObjectIdType, ref: "User" }], default: [], index: true },
    sharedWith: { type: [{ type: ObjectIdType, ref: "User" }], default: [] },
    reporter: { type: ObjectIdType, ref: "User" },
    reviewer: { type: ObjectIdType, ref: "User" },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium" },
    status: { type: String, required: true, index: true },
    startDate: String,
    dueDate: { type: String, index: true },
    completedAt: Date,
    estimateHours: { type: Number, default: 0 },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    dependencies: { type: [{ type: ObjectIdType, ref: "Task" }], default: [] },
    blocker: String,
    isLearning: { type: Boolean, default: false },
    attachments: { type: [FileRefSchema], default: [] },
    comments: { type: [CommentSchema], default: [] },
    submissions: { type: [SubmissionSchema], default: [] },
    history: { type: [HistorySchema], default: [] },
    deadlineNotifiedAt: Date,
  },
  { timestamps: true },
);
TaskSchema.index({ title: "text", taskNo: "text" });

export const Task = defineModel<ITask>("Task", TaskSchema);

export type TimesheetStatus = "draft" | "submitted" | "approved" | "rejected";

export interface ITimesheetEntry {
  _id: ObjectId;
  user: ObjectId;
  date: string;
  weekStart: string;
  project?: ObjectId;
  task?: ObjectId;
  minutes: number;
  description: string;
  billable: boolean;
  status: TimesheetStatus;
  submittedAt?: Date;
  reviewer?: ObjectId;
  reviewerName?: string;
  reviewedAt?: Date;
  reviewNote?: string;
  history: HistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const TimesheetEntrySchema = new Schema<ITimesheetEntry>(
  {
    user: { type: ObjectIdType, ref: "User", required: true },
    date: { type: String, required: true },
    weekStart: { type: String, required: true },
    project: { type: ObjectIdType, ref: "Project", index: true },
    task: { type: ObjectIdType, ref: "Task", index: true },
    minutes: { type: Number, required: true, min: 1, max: 24 * 60 },
    description: { type: String, required: true, maxlength: 2000 },
    billable: { type: Boolean, default: true },
    status: { type: String, enum: ["draft", "submitted", "approved", "rejected"], default: "draft", index: true },
    submittedAt: Date,
    reviewer: { type: ObjectIdType, ref: "User" },
    reviewerName: String,
    reviewedAt: Date,
    reviewNote: String,
    history: { type: [HistorySchema], default: [] },
  },
  { timestamps: true },
);
TimesheetEntrySchema.index({ user: 1, weekStart: 1 });
TimesheetEntrySchema.index({ user: 1, date: 1 });

export const TimesheetEntry = defineModel<ITimesheetEntry>("TimesheetEntry", TimesheetEntrySchema);

export type IssueStatus = "open" | "assigned" | "in_progress" | "fixed" | "ready_for_testing" | "reopened" | "verified" | "closed";
export const ISSUE_STATUSES: IssueStatus[] = ["open", "assigned", "in_progress", "fixed", "ready_for_testing", "reopened", "verified", "closed"];
export type IssueSeverity = "critical" | "major" | "minor" | "trivial";

export interface IIssue {
  _id: ObjectId;
  issueNo: string;
  project: ObjectId;
  task?: ObjectId;
  title: string;
  description?: string;
  severity: IssueSeverity;
  priority: Priority;
  stepsToReproduce?: string;
  environment?: string;
  attachments: FileRef[];
  assignee?: ObjectId;
  team?: string;
  reporter: ObjectId;
  reportedDate: string;
  targetDate?: string;
  status: IssueStatus;
  resolution?: string;
  resolvedAt?: Date;
  verifiedBy?: ObjectId;
  closedAt?: Date;
  reopenCount: number;
  comments: CommentEntry[];
  history: HistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const IssueSchema = new Schema<IIssue>(
  {
    issueNo: { type: String, required: true, unique: true },
    project: { type: ObjectIdType, ref: "Project", required: true, index: true },
    task: { type: ObjectIdType, ref: "Task" },
    title: { type: String, required: true, trim: true, maxlength: 300 },
    description: { type: String, maxlength: 20000 },
    severity: { type: String, enum: ["critical", "major", "minor", "trivial"], default: "minor" },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium" },
    stepsToReproduce: { type: String, maxlength: 10000 },
    environment: String,
    attachments: { type: [FileRefSchema], default: [] },
    assignee: { type: ObjectIdType, ref: "User", index: true },
    team: String,
    reporter: { type: ObjectIdType, ref: "User", required: true },
    reportedDate: { type: String, required: true },
    targetDate: String,
    status: {
      type: String,
      enum: ["open", "assigned", "in_progress", "fixed", "ready_for_testing", "reopened", "verified", "closed"],
      default: "open",
      index: true,
    },
    resolution: String,
    resolvedAt: Date,
    verifiedBy: { type: ObjectIdType, ref: "User" },
    closedAt: Date,
    reopenCount: { type: Number, default: 0 },
    comments: { type: [CommentSchema], default: [] },
    history: { type: [HistorySchema], default: [] },
  },
  { timestamps: true },
);
IssueSchema.index({ title: "text", issueNo: "text" });

export const Issue = defineModel<IIssue>("Issue", IssueSchema);
