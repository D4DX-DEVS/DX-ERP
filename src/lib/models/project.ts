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

export type Priority = "low" | "medium" | "high" | "urgent";
export const PRIORITIES: Priority[] = ["low", "medium", "high", "urgent"];

export interface Milestone {
  _id: ObjectId;
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
  invoice?: ObjectId;
}

export interface TeamMember {
  _id?: ObjectId;
  user: ObjectId;
  role?: string;
  allocation: number;
}

export interface IProject {
  _id: ObjectId;
  projectNo: string;
  title: string;
  client?: ObjectId;
  internal: boolean;
  description?: string;
  scope?: string;
  deliverables: string[];
  manager?: ObjectId;
  team: TeamMember[];
  startDate?: string;
  targetDate?: string;
  completedDate?: string;
  budget: number;
  estimatedHours: number;
  priority: Priority;
  status: string;
  proposal?: ObjectId;
  contract?: ObjectId;
  milestones: Milestone[];
  tags: string[];
  attachments: FileRef[];
  comments: CommentEntry[];
  history: HistoryEntry[];
  createdBy?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const MilestoneSchema = new Schema<Milestone>({
  title: { type: String, required: true },
  description: String,
  dueDate: String,
  status: {
    type: String,
    enum: ["pending", "in_progress", "client_review", "approved", "delivered", "delayed"],
    default: "pending",
  },
  deliveredAt: String,
  clientReviewNote: String,
  approvedBy: String,
  approvedAt: Date,
  releaseNotes: String,
  amount: Number,
  invoiced: { type: Boolean, default: false },
  invoice: { type: ObjectIdType, ref: "Invoice" },
});

const ProjectSchema = new Schema<IProject>(
  {
    projectNo: { type: String, required: true, unique: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    client: { type: ObjectIdType, ref: "Client", index: true },
    internal: { type: Boolean, default: false },
    description: String,
    scope: String,
    deliverables: { type: [String], default: [] },
    manager: { type: ObjectIdType, ref: "User", index: true },
    team: {
      type: [
        new Schema<TeamMember>({
          user: { type: ObjectIdType, ref: "User", required: true },
          role: String,
          allocation: { type: Number, default: 100, min: 0, max: 100 },
        }),
      ],
      default: [],
    },
    startDate: String,
    targetDate: String,
    completedDate: String,
    budget: { type: Number, default: 0 },
    estimatedHours: { type: Number, default: 0 },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium" },
    status: { type: String, required: true, index: true },
    proposal: { type: ObjectIdType, ref: "Proposal" },
    contract: { type: ObjectIdType, ref: "Contract" },
    milestones: { type: [MilestoneSchema], default: [] },
    tags: { type: [String], default: [] },
    attachments: { type: [FileRefSchema], default: [] },
    comments: { type: [CommentSchema], default: [] },
    history: { type: [HistorySchema], default: [] },
    createdBy: { type: ObjectIdType, ref: "User" },
  },
  { timestamps: true },
);
ProjectSchema.index({ "team.user": 1 });
ProjectSchema.index({ title: "text", projectNo: "text" });

export const Project = defineModel<IProject>("Project", ProjectSchema);
