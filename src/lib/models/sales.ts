import { index, sqliteTable, uniqueIndex } from "drizzle-orm/sqlite-core";
import { bool, date, int, json, num, pk, ref, text, timestamps, type FileRef, type HistoryEntry, type Id, type LineItem } from "./_base";

export type ProposalStatus = "draft" | "sent" | "negotiation" | "approved" | "rejected" | "expired" | "converted";

export interface PaymentMilestone {
  _id?: Id;
  title: string;
  percent: number;
  amount: number;
  dueOn?: string;
}

/** The commercial content of a proposal — also stored as each revision's snapshot. */
export interface ProposalContent {
  title: string;
  summary?: string;
  scope?: string;
  deliverables: string[];
  timeline?: string;
  startDate?: string;
  endDate?: string;
  items: LineItem[];
  discount: number;
  subtotal: number;
  taxTotal: number;
  total: number;
  paymentMilestones: PaymentMilestone[];
  terms?: string;
  validUntil?: string;
}

export interface ProposalRevision {
  _id?: Id;
  version: number;
  snapshot: ProposalContent;
  note?: string;
  by?: Id;
  byName?: string;
  at: Date;
}

export const Proposal = sqliteTable(
  "proposals",
  {
    _id: pk(),
    proposalNo: text().notNull(),
    kind: text().$type<"proposal" | "quotation">().notNull().default("proposal"),
    version: int().notNull().default(1),
    client: ref().notNull(),
    lead: ref(),
    // ProposalContent fields
    title: text().notNull(),
    summary: text(),
    scope: text(),
    deliverables: json<string[]>()
      .notNull()
      .$defaultFn(() => []),
    timeline: text(),
    startDate: text(),
    endDate: text(),
    items: json<LineItem[]>()
      .notNull()
      .$defaultFn(() => []),
    discount: num().notNull().default(0),
    subtotal: num().notNull().default(0),
    taxTotal: num().notNull().default(0),
    total: num().notNull().default(0),
    paymentMilestones: json<PaymentMilestone[]>()
      .notNull()
      .$defaultFn(() => []),
    terms: text(),
    validUntil: text(),
    // workflow
    status: text().$type<ProposalStatus>().notNull().default("draft"),
    sentAt: date(),
    decidedAt: date(),
    decisionNote: text(),
    approvedBy: ref(),
    approvedByName: text(),
    project: ref(),
    attachments: json<FileRef[]>()
      .notNull()
      .$defaultFn(() => []),
    revisions: json<ProposalRevision[]>()
      .notNull()
      .$defaultFn(() => []),
    history: json<HistoryEntry[]>()
      .notNull()
      .$defaultFn(() => []),
    owner: ref(),
    createdBy: ref(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("proposals_proposal_no").on(t.proposalNo), index("proposals_client").on(t.client), index("proposals_status").on(t.status)],
);
export type IProposal = typeof Proposal.$inferSelect;

export type ContractStatus = "draft" | "active" | "expired" | "terminated" | "renewed";

export const Contract = sqliteTable(
  "contracts",
  {
    _id: pk(),
    contractNo: text().notNull(),
    title: text().notNull(),
    client: ref().notNull(),
    project: ref(),
    proposal: ref(),
    type: text(),
    startDate: text(),
    endDate: text(),
    value: num().notNull().default(0),
    signedOn: text(),
    status: text().$type<ContractStatus>().notNull().default("active"),
    confidential: bool().notNull().default(true),
    renewalReminderDays: int().notNull().default(30),
    autoRenew: bool().notNull().default(false),
    notes: text(),
    attachments: json<FileRef[]>()
      .notNull()
      .$defaultFn(() => []),
    renewedFrom: ref(),
    reminderSentAt: date(),
    history: json<HistoryEntry[]>()
      .notNull()
      .$defaultFn(() => []),
    createdBy: ref(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("contracts_contract_no").on(t.contractNo),
    index("contracts_client").on(t.client),
    index("contracts_end_date").on(t.endDate),
    index("contracts_status").on(t.status),
  ],
);
export type IContract = typeof Contract.$inferSelect;
