import {
  defineModel,
  FileRefSchema,
  ObjectIdType,
  Schema,
  type FileRef,
  type HistoryEntry,
  type ObjectId,
} from "./_base";

export type AssetStatus = "available" | "assigned" | "in_repair" | "damaged" | "lost" | "retired";
export type AssetCondition = "new" | "good" | "fair" | "poor" | "damaged";

export interface IAsset {
  _id: ObjectId;
  assetNo: string;
  name: string;
  category: string;
  brand?: string;
  model?: string;
  serialNo?: string;
  purchaseDate?: string;
  cost: number;
  vendor?: string;
  invoiceRef?: string;
  warrantyUntil?: string;
  serviceProvider?: string;
  nextServiceDate?: string;
  assignedTo?: ObjectId;
  department?: ObjectId;
  location?: string;
  condition: AssetCondition;
  status: AssetStatus;
  notes?: string;
  documents: FileRef[];
  history: (HistoryEntry & { user?: ObjectId; userName?: string })[];
  reminderSentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AssetHistorySchema = new Schema<HistoryEntry & { user?: ObjectId; userName?: string }>({
  action: { type: String, required: true },
  by: { type: ObjectIdType, ref: "User" },
  byName: String,
  at: { type: Date, default: Date.now },
  note: String,
  from: String,
  to: String,
  user: { type: ObjectIdType, ref: "User" },
  userName: String,
});

const AssetSchema = new Schema<IAsset>(
  {
    assetNo: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    category: { type: String, required: true },
    brand: String,
    model: String,
    serialNo: { type: String, trim: true },
    purchaseDate: String,
    cost: { type: Number, default: 0 },
    vendor: String,
    invoiceRef: String,
    warrantyUntil: { type: String, index: true },
    serviceProvider: String,
    nextServiceDate: { type: String, index: true },
    assignedTo: { type: ObjectIdType, ref: "User", index: true },
    department: { type: ObjectIdType, ref: "Department" },
    location: String,
    condition: { type: String, enum: ["new", "good", "fair", "poor", "damaged"], default: "good" },
    status: {
      type: String,
      enum: ["available", "assigned", "in_repair", "damaged", "lost", "retired"],
      default: "available",
      index: true,
    },
    notes: String,
    documents: { type: [FileRefSchema], default: [] },
    history: { type: [AssetHistorySchema], default: [] },
    reminderSentAt: Date,
  },
  { timestamps: true },
);
AssetSchema.index({ name: "text", assetNo: "text", serialNo: "text" });

export const Asset = defineModel<IAsset>("Asset", AssetSchema);

export interface INotification {
  _id: ObjectId;
  user: ObjectId;
  type: string;
  title: string;
  body?: string;
  link?: string;
  priority: "normal" | "high";
  read: boolean;
  readAt?: Date;
  dedupeKey?: string;
  actionable: boolean;
  createdAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    user: { type: ObjectIdType, ref: "User", required: true },
    type: { type: String, required: true },
    title: { type: String, required: true, maxlength: 300 },
    body: { type: String, maxlength: 2000 },
    link: String,
    priority: { type: String, enum: ["normal", "high"], default: "normal" },
    read: { type: Boolean, default: false },
    readAt: Date,
    dedupeKey: String,
    actionable: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
NotificationSchema.index({ user: 1, read: 1, createdAt: -1 });
NotificationSchema.index({ user: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } });

export const Notification = defineModel<INotification>("Notification", NotificationSchema);

export interface IAnnouncement {
  _id: ObjectId;
  title: string;
  body: string;
  audience: string[];
  pinned: boolean;
  publishedBy: ObjectId;
  publishedByName: string;
  expiresOn?: string;
  createdAt: Date;
}

const AnnouncementSchema = new Schema<IAnnouncement>(
  {
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, required: true, maxlength: 5000 },
    audience: { type: [String], default: ["all"] },
    pinned: { type: Boolean, default: false },
    publishedBy: { type: ObjectIdType, ref: "User", required: true },
    publishedByName: String,
    expiresOn: String,
  },
  { timestamps: true },
);

export const Announcement = defineModel<IAnnouncement>("Announcement", AnnouncementSchema);

/** Approved training materials and learning activities (FRS §4.3, §6.3). */
export interface ILearningResource {
  _id: ObjectId;
  title: string;
  description?: string;
  kind: "document" | "video" | "link" | "course" | "activity";
  url?: string;
  attachments: FileRef[];
  audience: string[];
  department?: ObjectId;
  assignedTo: ObjectId[];
  dueDate?: string;
  estimatedHours?: number;
  completions: { user: ObjectId; at: Date; note?: string }[];
  active: boolean;
  createdBy: ObjectId;
  createdByName: string;
  createdAt: Date;
}

const LearningResourceSchema = new Schema<ILearningResource>(
  {
    title: { type: String, required: true, maxlength: 200 },
    description: { type: String, maxlength: 5000 },
    kind: { type: String, enum: ["document", "video", "link", "course", "activity"], default: "link" },
    url: String,
    attachments: { type: [FileRefSchema], default: [] },
    audience: { type: [String], default: ["intern", "trainee"] },
    department: { type: ObjectIdType, ref: "Department" },
    assignedTo: { type: [{ type: ObjectIdType, ref: "User" }], default: [] },
    dueDate: String,
    estimatedHours: Number,
    completions: {
      type: [new Schema({ user: { type: ObjectIdType, ref: "User" }, at: Date, note: String }, { _id: false })],
      default: [],
    },
    active: { type: Boolean, default: true },
    createdBy: { type: ObjectIdType, ref: "User", required: true },
    createdByName: String,
  },
  { timestamps: true },
);

export const LearningResource = defineModel<ILearningResource>("LearningResource", LearningResourceSchema);

/** Progress evaluations / feedback for interns and trainees (FRS §6.2 steps 7–8). */
export interface IReview {
  _id: ObjectId;
  user: ObjectId;
  reviewer: ObjectId;
  reviewerName: string;
  periodLabel: string;
  date: string;
  ratings: { key: string; label: string; score: number }[];
  overall: number;
  strengths?: string;
  improvements?: string;
  actionItems: { _id?: ObjectId; text: string; status: "open" | "done"; doneAt?: Date }[];
  status: "draft" | "shared";
  acknowledgedAt?: Date;
  internComment?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ReviewSchema = new Schema<IReview>(
  {
    user: { type: ObjectIdType, ref: "User", required: true, index: true },
    reviewer: { type: ObjectIdType, ref: "User", required: true },
    reviewerName: String,
    periodLabel: { type: String, required: true },
    date: { type: String, required: true },
    ratings: {
      type: [new Schema({ key: String, label: String, score: { type: Number, min: 1, max: 5 } }, { _id: false })],
      default: [],
    },
    overall: { type: Number, min: 1, max: 5 },
    strengths: String,
    improvements: String,
    actionItems: {
      type: [new Schema({ text: String, status: { type: String, enum: ["open", "done"], default: "open" }, doneAt: Date })],
      default: [],
    },
    status: { type: String, enum: ["draft", "shared"], default: "draft" },
    acknowledgedAt: Date,
    internComment: String,
  },
  { timestamps: true },
);

export const Review = defineModel<IReview>("Review", ReviewSchema);
