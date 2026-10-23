import {
  AddressSchema,
  defineModel,
  FileRefSchema,
  HistorySchema,
  ObjectIdType,
  Schema,
  type Address,
  type FileRef,
  type HistoryEntry,
  type ObjectId,
} from "./_base";

export type ClientStatus = "lead" | "prospect" | "active" | "inactive" | "lost";

export interface IClient {
  _id: ObjectId;
  clientNo: string;
  name: string;
  type: "company" | "individual";
  contactPerson?: string;
  contactDesignation?: string;
  email?: string;
  phone?: string;
  altPhone?: string;
  website?: string;
  industry?: string;
  gstin?: string;
  address?: Address;
  leadSource?: string;
  owner?: ObjectId;
  status: ClientStatus;
  /** Restricted clients are only visible to users with `crm.confidential` and the owner. */
  confidential: boolean;
  notes?: string;
  contacts: { _id?: ObjectId; name: string; designation?: string; email?: string; phone?: string }[];
  attachments: FileRef[];
  createdBy?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ClientSchema = new Schema<IClient>(
  {
    clientNo: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    type: { type: String, enum: ["company", "individual"], default: "company" },
    contactPerson: String,
    contactDesignation: String,
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    altPhone: String,
    website: String,
    industry: String,
    gstin: { type: String, uppercase: true, trim: true },
    address: AddressSchema,
    leadSource: String,
    owner: { type: ObjectIdType, ref: "User", index: true },
    status: { type: String, enum: ["lead", "prospect", "active", "inactive", "lost"], default: "prospect", index: true },
    confidential: { type: Boolean, default: false },
    notes: String,
    contacts: {
      type: [new Schema({ name: { type: String, required: true }, designation: String, email: String, phone: String })],
      default: [],
    },
    attachments: { type: [FileRefSchema], default: [] },
    createdBy: { type: ObjectIdType, ref: "User" },
  },
  { timestamps: true },
);
ClientSchema.index({ name: "text", contactPerson: "text", email: "text", clientNo: "text" });

export const Client = defineModel<IClient>("Client", ClientSchema);

export interface ILead {
  _id: ObjectId;
  leadNo: string;
  title: string;
  client?: ObjectId;
  companyName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  requirement?: string;
  budget?: number;
  expectedValue?: number;
  source?: string;
  assignedTo?: ObjectId;
  stage: string;
  status: "open" | "won" | "lost";
  lostReason?: string;
  nextFollowUp?: Date;
  expectedCloseDate?: string;
  proposal?: ObjectId;
  project?: ObjectId;
  convertedAt?: Date;
  /** When the lead was closed (marked won or lost). */
  closedAt?: Date;
  attachments: FileRef[];
  history: HistoryEntry[];
  createdBy?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const LeadSchema = new Schema<ILead>(
  {
    leadNo: { type: String, required: true, unique: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    client: { type: ObjectIdType, ref: "Client", index: true },
    companyName: { type: String, required: true, trim: true },
    contactName: String,
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    requirement: String,
    budget: Number,
    expectedValue: Number,
    source: String,
    assignedTo: { type: ObjectIdType, ref: "User", index: true },
    stage: { type: String, required: true, index: true },
    status: { type: String, enum: ["open", "won", "lost"], default: "open", index: true },
    lostReason: String,
    nextFollowUp: { type: Date, index: true },
    expectedCloseDate: String,
    proposal: { type: ObjectIdType, ref: "Proposal" },
    project: { type: ObjectIdType, ref: "Project" },
    convertedAt: Date,
    closedAt: Date,
    attachments: { type: [FileRefSchema], default: [] },
    history: { type: [HistorySchema], default: [] },
    createdBy: { type: ObjectIdType, ref: "User" },
  },
  { timestamps: true },
);
LeadSchema.index({ title: "text", companyName: "text", contactName: "text", leadNo: "text" });

export const Lead = defineModel<ILead>("Lead", LeadSchema);

export type ActivityType = "call" | "meeting" | "email" | "note" | "follow_up" | "whatsapp";

export interface IActivity {
  _id: ObjectId;
  client?: ObjectId;
  lead?: ObjectId;
  type: ActivityType;
  subject: string;
  notes?: string;
  at: Date;
  dueAt?: Date;
  done: boolean;
  doneAt?: Date;
  outcome?: string;
  attachments: FileRef[];
  by: ObjectId;
  byName: string;
  assignedTo?: ObjectId;
  reminderSentAt?: Date;
  createdAt: Date;
}

const ActivitySchema = new Schema<IActivity>(
  {
    client: { type: ObjectIdType, ref: "Client", index: true },
    lead: { type: ObjectIdType, ref: "Lead", index: true },
    type: { type: String, enum: ["call", "meeting", "email", "note", "follow_up", "whatsapp"], required: true },
    subject: { type: String, required: true, maxlength: 300 },
    notes: { type: String, maxlength: 10000 },
    at: { type: Date, default: Date.now },
    dueAt: { type: Date, index: true },
    done: { type: Boolean, default: true },
    doneAt: Date,
    outcome: String,
    attachments: { type: [FileRefSchema], default: [] },
    by: { type: ObjectIdType, ref: "User", required: true },
    byName: String,
    assignedTo: { type: ObjectIdType, ref: "User", index: true },
    reminderSentAt: Date,
  },
  { timestamps: true },
);

export const Activity = defineModel<IActivity>("Activity", ActivitySchema);
