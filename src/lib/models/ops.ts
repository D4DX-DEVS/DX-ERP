import { index, sqliteTable, uniqueIndex } from "drizzle-orm/sqlite-core";
import { bool, createdAt, date, json, num, pk, ref, text, timestamps, type FileRef, type HistoryEntry, type Id } from "./_base";

export type AssetStatus = "available" | "assigned" | "in_repair" | "damaged" | "lost" | "retired";
export type AssetCondition = "new" | "good" | "fair" | "poor" | "damaged";
export type AssetHistoryEntry = HistoryEntry & { user?: Id; userName?: string };

/** Writes must trim `name`/`serialNo`. */
export const Asset = sqliteTable(
  "assets",
  {
    _id: pk(),
    assetNo: text().notNull(),
    name: text().notNull(),
    category: text().notNull(),
    brand: text(),
    model: text(),
    serialNo: text(),
    purchaseDate: text(),
    cost: num().notNull().default(0),
    vendor: text(),
    invoiceRef: text(),
    warrantyUntil: text(),
    serviceProvider: text(),
    nextServiceDate: text(),
    assignedTo: ref(),
    department: ref(),
    location: text(),
    condition: text().$type<AssetCondition>().notNull().default("good"),
    status: text().$type<AssetStatus>().notNull().default("available"),
    notes: text(),
    documents: json<FileRef[]>()
      .notNull()
      .$defaultFn(() => []),
    history: json<AssetHistoryEntry[]>()
      .notNull()
      .$defaultFn(() => []),
    reminderSentAt: date(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("assets_asset_no").on(t.assetNo),
    index("assets_warranty_until").on(t.warrantyUntil),
    index("assets_next_service_date").on(t.nextServiceDate),
    index("assets_assigned_to").on(t.assignedTo),
    index("assets_status").on(t.status),
  ],
);
export type IAsset = typeof Asset.$inferSelect;

export const Notification = sqliteTable(
  "notifications",
  {
    _id: pk(),
    user: ref().notNull(),
    type: text().notNull(),
    title: text().notNull(),
    body: text(),
    link: text(),
    priority: text().$type<"normal" | "high">().notNull().default("normal"),
    read: bool().notNull().default(false),
    readAt: date(),
    dedupeKey: text(),
    actionable: bool().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("notifications_user_read_created").on(t.user, t.read, t.createdAt),
    // Rows without a dedupeKey (NULL) never collide: NULLs are distinct in SQLite unique indexes.
    uniqueIndex("notifications_user_dedupe_key").on(t.user, t.dedupeKey),
  ],
);
export type INotification = typeof Notification.$inferSelect;

export const Announcement = sqliteTable("announcements", {
  _id: pk(),
  title: text().notNull(),
  body: text().notNull(),
  audience: json<string[]>()
    .notNull()
    .$defaultFn(() => ["all"]),
  pinned: bool().notNull().default(false),
  publishedBy: ref().notNull(),
  publishedByName: text(),
  expiresOn: text(),
  ...timestamps(),
});
export type IAnnouncement = typeof Announcement.$inferSelect;

export interface LearningCompletion {
  user: Id;
  at: Date;
  note?: string;
}

/** Approved training materials and learning activities (FRS §4.3, §6.3). */
export const LearningResource = sqliteTable("learningresources", {
  _id: pk(),
  title: text().notNull(),
  description: text(),
  kind: text().$type<"document" | "video" | "link" | "course" | "activity">().notNull().default("link"),
  url: text(),
  attachments: json<FileRef[]>()
    .notNull()
    .$defaultFn(() => []),
  audience: json<string[]>()
    .notNull()
    .$defaultFn(() => ["intern", "trainee"]),
  department: ref(),
  assignedTo: json<Id[]>()
    .notNull()
    .$defaultFn(() => []),
  dueDate: text(),
  estimatedHours: num(),
  completions: json<LearningCompletion[]>()
    .notNull()
    .$defaultFn(() => []),
  active: bool().notNull().default(true),
  createdBy: ref().notNull(),
  createdByName: text(),
  ...timestamps(),
});
export type ILearningResource = typeof LearningResource.$inferSelect;

export interface ReviewRating {
  key: string;
  label: string;
  score: number;
}

export interface ReviewActionItem {
  _id?: Id;
  text: string;
  status: "open" | "done";
  doneAt?: Date;
}

/** Progress evaluations / feedback for interns and trainees (FRS §6.2 steps 7–8). */
export const Review = sqliteTable(
  "reviews",
  {
    _id: pk(),
    user: ref().notNull(),
    reviewer: ref().notNull(),
    reviewerName: text(),
    periodLabel: text().notNull(),
    date: text().notNull(),
    ratings: json<ReviewRating[]>()
      .notNull()
      .$defaultFn(() => []),
    overall: num(),
    strengths: text(),
    improvements: text(),
    actionItems: json<ReviewActionItem[]>()
      .notNull()
      .$defaultFn(() => []),
    status: text().$type<"draft" | "shared">().notNull().default("draft"),
    acknowledgedAt: date(),
    internComment: text(),
    ...timestamps(),
  },
  (t) => [index("reviews_user").on(t.user)],
);
export type IReview = typeof Review.$inferSelect;
