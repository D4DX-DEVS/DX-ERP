import { index, sqliteTable, uniqueIndex } from "drizzle-orm/sqlite-core";
import { bool, date, int, json, pk, ref, text, timestamps, type HistoryEntry, type Id } from "./_base";

/** Movement status (where the person is) — FRS §8.6. */
export type MovementStatus = "draft" | "out" | "returned" | "cancelled";
/** Approval status is tracked separately from movement status. */
export type MovementApproval = "not_required" | "pending" | "approved" | "rejected" | "correction_requested";

export interface MovementCorrection {
  _id?: Id;
  requestedBy: Id;
  requestedByName: string;
  requestedAt: Date;
  reason: string;
  proposedOutTime?: Date;
  proposedInTime?: Date;
  originalOutTime?: Date;
  originalInTime?: Date;
  /** Approval status before the correction was requested (restored on rejection). */
  previousApprovalStatus?: MovementApproval;
  status: "pending" | "approved" | "rejected";
  reviewedBy?: Id;
  reviewedByName?: string;
  reviewedAt?: Date;
  reviewNote?: string;
}

export const Movement = sqliteTable(
  "movements",
  {
    _id: pk(),
    movementNo: text().notNull(),
    user: ref().notNull(),
    date: text().notNull(),
    outTime: date(),
    expectedReturn: date(),
    inTime: date(),
    /** Final duration in minutes; only set once In-Time is recorded or the record is resolved. */
    durationMinutes: int(),
    category: text().notNull(),
    categoryLabel: text().notNull(),
    official: bool().notNull().default(true),
    purpose: text().notNull(),
    destination: text(),
    project: ref(),
    client: ref(),
    remarks: text(),
    status: text().$type<MovementStatus>().notNull().default("out"),
    approvalStatus: text().$type<MovementApproval>().notNull().default("not_required"),
    approver: ref(),
    approvedBy: ref(),
    approvedByName: text(),
    approvedAt: date(),
    approvalNote: text(),
    /** "live" = recorded at the time; "alternative" = entered afterwards by the person or an authorised user (§8.4). */
    entryMode: text().$type<"live" | "alternative">().notNull().default("live"),
    enteredBy: ref(),
    enteredByName: text(),
    alternativeReason: text(),
    resolvedBy: ref(),
    resolvedByName: text(),
    resolutionNote: text(),
    overdueNotifiedAt: date(),
    corrections: json<MovementCorrection[]>()
      .notNull()
      .$defaultFn(() => []),
    history: json<HistoryEntry[]>()
      .notNull()
      .$defaultFn(() => []),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("movements_movement_no").on(t.movementNo),
    index("movements_user_date").on(t.user, t.date),
    index("movements_date").on(t.date),
    index("movements_status_expected_return").on(t.status, t.expectedReturn),
    index("movements_approval_status").on(t.approvalStatus),
  ],
);
export type IMovement = typeof Movement.$inferSelect;
