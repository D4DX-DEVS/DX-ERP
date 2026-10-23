import {
  defineModel,
  FileRefSchema,
  HistorySchema,
  LineItemSchema,
  ObjectIdType,
  Schema,
  type FileRef,
  type HistoryEntry,
  type LineItem,
  type ObjectId,
} from "./_base";

export type ProposalStatus = "draft" | "sent" | "negotiation" | "approved" | "rejected" | "expired" | "converted";

export interface PaymentMilestone {
  _id?: ObjectId;
  title: string;
  percent: number;
  amount: number;
  dueOn?: string;
}

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

export interface IProposal extends ProposalContent {
  _id: ObjectId;
  proposalNo: string;
  kind: "proposal" | "quotation";
  version: number;
  client: ObjectId;
  lead?: ObjectId;
  status: ProposalStatus;
  sentAt?: Date;
  decidedAt?: Date;
  decisionNote?: string;
  approvedBy?: ObjectId;
  approvedByName?: string;
  project?: ObjectId;
  attachments: FileRef[];
  revisions: { _id?: ObjectId; version: number; snapshot: ProposalContent; note?: string; by?: ObjectId; byName?: string; at: Date }[];
  history: HistoryEntry[];
  owner?: ObjectId;
  createdBy?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentMilestoneSchema = new Schema<PaymentMilestone>({
  title: { type: String, required: true },
  percent: { type: Number, default: 0 },
  amount: { type: Number, default: 0 },
  dueOn: String,
});

const ProposalSchema = new Schema<IProposal>(
  {
    proposalNo: { type: String, required: true, unique: true },
    kind: { type: String, enum: ["proposal", "quotation"], default: "proposal" },
    version: { type: Number, default: 1 },
    client: { type: ObjectIdType, ref: "Client", required: true, index: true },
    lead: { type: ObjectIdType, ref: "Lead" },
    title: { type: String, required: true, maxlength: 200 },
    summary: String,
    scope: String,
    deliverables: { type: [String], default: [] },
    timeline: String,
    startDate: String,
    endDate: String,
    items: { type: [LineItemSchema], default: [] },
    discount: { type: Number, default: 0 },
    subtotal: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    paymentMilestones: { type: [PaymentMilestoneSchema], default: [] },
    terms: String,
    validUntil: String,
    status: {
      type: String,
      enum: ["draft", "sent", "negotiation", "approved", "rejected", "expired", "converted"],
      default: "draft",
      index: true,
    },
    sentAt: Date,
    decidedAt: Date,
    decisionNote: String,
    approvedBy: { type: ObjectIdType, ref: "User" },
    approvedByName: String,
    project: { type: ObjectIdType, ref: "Project" },
    attachments: { type: [FileRefSchema], default: [] },
    revisions: {
      type: [
        new Schema({
          version: Number,
          snapshot: Schema.Types.Mixed,
          note: String,
          by: { type: ObjectIdType, ref: "User" },
          byName: String,
          at: { type: Date, default: Date.now },
        }),
      ],
      default: [],
    },
    history: { type: [HistorySchema], default: [] },
    owner: { type: ObjectIdType, ref: "User" },
    createdBy: { type: ObjectIdType, ref: "User" },
  },
  { timestamps: true },
);
ProposalSchema.index({ title: "text", proposalNo: "text" });

export const Proposal = defineModel<IProposal>("Proposal", ProposalSchema);

export type ContractStatus = "draft" | "active" | "expired" | "terminated" | "renewed";

export interface IContract {
  _id: ObjectId;
  contractNo: string;
  title: string;
  client: ObjectId;
  project?: ObjectId;
  proposal?: ObjectId;
  type?: string;
  startDate?: string;
  endDate?: string;
  value: number;
  signedOn?: string;
  status: ContractStatus;
  confidential: boolean;
  renewalReminderDays: number;
  autoRenew: boolean;
  notes?: string;
  attachments: FileRef[];
  renewedFrom?: ObjectId;
  reminderSentAt?: Date;
  history: HistoryEntry[];
  createdBy?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ContractSchema = new Schema<IContract>(
  {
    contractNo: { type: String, required: true, unique: true },
    title: { type: String, required: true, maxlength: 200 },
    client: { type: ObjectIdType, ref: "Client", required: true, index: true },
    project: { type: ObjectIdType, ref: "Project" },
    proposal: { type: ObjectIdType, ref: "Proposal" },
    type: String,
    startDate: String,
    endDate: { type: String, index: true },
    value: { type: Number, default: 0 },
    signedOn: String,
    status: { type: String, enum: ["draft", "active", "expired", "terminated", "renewed"], default: "active", index: true },
    confidential: { type: Boolean, default: true },
    renewalReminderDays: { type: Number, default: 30 },
    autoRenew: { type: Boolean, default: false },
    notes: String,
    attachments: { type: [FileRefSchema], default: [] },
    renewedFrom: { type: ObjectIdType, ref: "Contract" },
    reminderSentAt: Date,
    history: { type: [HistorySchema], default: [] },
    createdBy: { type: ObjectIdType, ref: "User" },
  },
  { timestamps: true },
);
ContractSchema.index({ title: "text", contractNo: "text" });

export const Contract = defineModel<IContract>("Contract", ContractSchema);
