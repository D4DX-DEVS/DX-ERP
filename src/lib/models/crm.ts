import { index, sqliteTable, uniqueIndex } from "drizzle-orm/sqlite-core";
import { bool, date, json, num, pk, ref, text, timestamps, type Address, type FileRef, type HistoryEntry, type Id } from "./_base";

export type ClientStatus = "lead" | "prospect" | "active" | "inactive" | "lost";

export interface ClientContact {
  _id?: Id;
  name: string;
  designation?: string;
  email?: string;
  phone?: string;
}

/** Writes must trim `name`/`phone`, lowercase + trim `email`, uppercase + trim `gstin`. */
export const Client = sqliteTable(
  "clients",
  {
    _id: pk(),
    clientNo: text().notNull(),
    name: text().notNull(),
    type: text().$type<"company" | "individual">().notNull().default("company"),
    contactPerson: text(),
    contactDesignation: text(),
    email: text(),
    phone: text(),
    altPhone: text(),
    website: text(),
    industry: text(),
    gstin: text(),
    address: json<Address>(),
    leadSource: text(),
    owner: ref(),
    status: text().$type<ClientStatus>().notNull().default("prospect"),
    /** Restricted clients are only visible to users with `crm.confidential` and the owner. */
    confidential: bool().notNull().default(false),
    notes: text(),
    contacts: json<ClientContact[]>()
      .notNull()
      .$defaultFn(() => []),
    attachments: json<FileRef[]>()
      .notNull()
      .$defaultFn(() => []),
    createdBy: ref(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("clients_client_no").on(t.clientNo), index("clients_owner").on(t.owner), index("clients_status").on(t.status)],
);
export type IClient = typeof Client.$inferSelect;

/** Writes must trim `title`/`companyName`/`phone` and lowercase + trim `email`. */
export const Lead = sqliteTable(
  "leads",
  {
    _id: pk(),
    leadNo: text().notNull(),
    title: text().notNull(),
    client: ref(),
    companyName: text().notNull(),
    contactName: text(),
    email: text(),
    phone: text(),
    requirement: text(),
    budget: num(),
    expectedValue: num(),
    source: text(),
    assignedTo: ref(),
    stage: text().notNull(),
    status: text().$type<"open" | "won" | "lost">().notNull().default("open"),
    lostReason: text(),
    nextFollowUp: date(),
    expectedCloseDate: text(),
    proposal: ref(),
    project: ref(),
    convertedAt: date(),
    /** When the lead was closed (marked won or lost). */
    closedAt: date(),
    attachments: json<FileRef[]>()
      .notNull()
      .$defaultFn(() => []),
    history: json<HistoryEntry[]>()
      .notNull()
      .$defaultFn(() => []),
    createdBy: ref(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("leads_lead_no").on(t.leadNo),
    index("leads_client").on(t.client),
    index("leads_assigned_to").on(t.assignedTo),
    index("leads_stage").on(t.stage),
    index("leads_status").on(t.status),
    index("leads_next_follow_up").on(t.nextFollowUp),
  ],
);
export type ILead = typeof Lead.$inferSelect;

export type ActivityType = "call" | "meeting" | "email" | "note" | "follow_up" | "whatsapp";

export const Activity = sqliteTable(
  "activities",
  {
    _id: pk(),
    client: ref(),
    lead: ref(),
    type: text().$type<ActivityType>().notNull(),
    subject: text().notNull(),
    notes: text(),
    at: date()
      .notNull()
      .$defaultFn(() => new Date()),
    dueAt: date(),
    done: bool().notNull().default(true),
    doneAt: date(),
    outcome: text(),
    attachments: json<FileRef[]>()
      .notNull()
      .$defaultFn(() => []),
    by: ref().notNull(),
    byName: text(),
    assignedTo: ref(),
    reminderSentAt: date(),
    ...timestamps(),
  },
  (t) => [
    index("activities_client").on(t.client),
    index("activities_lead").on(t.lead),
    index("activities_due_at").on(t.dueAt),
    index("activities_assigned_to").on(t.assignedTo),
  ],
);
export type IActivity = typeof Activity.$inferSelect;
