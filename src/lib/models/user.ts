import {
  AddressSchema,
  defineModel,
  ObjectIdType,
  Schema,
  type Address,
  type ObjectId,
} from "./_base";

export type PersonType = "employee" | "trainee" | "intern" | "admin";
export const PERSON_TYPES: PersonType[] = ["employee", "trainee", "intern"];

export const EMPLOYMENT_TYPES = [
  "full_time",
  "part_time",
  "contract",
  "consultant",
  "trainee",
  "internship",
] as const;

export type LifecycleType =
  | "joined"
  | "promotion"
  | "designation_change"
  | "department_change"
  | "manager_change"
  | "role_change"
  | "salary_revision"
  | "stipend_revision"
  | "status_change"
  | "access_change"
  | "resignation"
  | "exit"
  | "note";

export interface LifecycleEvent {
  _id?: ObjectId;
  type: LifecycleType;
  date: string;
  summary: string;
  from?: string;
  to?: string;
  note?: string;
  confidential?: boolean;
  by?: ObjectId;
  byName?: string;
  at: Date;
}

export interface MoneyLine {
  name: string;
  amount: number;
}

export interface SalaryStructure {
  basic: number;
  allowances: MoneyLine[];
  deductions: MoneyLine[];
  effectiveFrom?: string;
}

export interface SalaryRevision extends SalaryStructure {
  _id?: ObjectId;
  note?: string;
  by?: ObjectId;
  byName?: string;
  at: Date;
}

export interface InternObjective {
  _id?: ObjectId;
  text: string;
  status: "open" | "in_progress" | "achieved" | "dropped";
  note?: string;
  updatedAt?: Date;
}

export interface Internship {
  startDate?: string;
  endDate?: string;
  college?: string;
  course?: string;
  assignedRole?: string;
  mentor?: ObjectId;
  objectives: InternObjective[];
  status: "registered" | "active" | "extended" | "completed" | "terminated";
  stipend: { eligible: boolean; amount: number; period: "monthly" | "one_time" };
  stipendHistory: { _id?: ObjectId; amount: number; effectiveFrom?: string; note?: string; by?: ObjectId; at: Date }[];
  certificateStatus: "none" | "requested" | "approved" | "issued";
  certificateNo?: string;
  certificateIssuedAt?: Date;
  certificateApprovedBy?: ObjectId;
  completionNote?: string;
  completedAt?: Date;
}

export interface OnboardingStep {
  key: string;
  label: string;
  done: boolean;
  doneAt?: Date;
  doneBy?: ObjectId;
}

export interface IUser {
  _id: ObjectId;
  employeeId: string;
  name: string;
  email: string;
  personalEmail?: string;
  phone?: string;
  photo?: string;
  personType: PersonType;
  role: string;
  isSuperAdmin: boolean;
  department?: ObjectId;
  designation?: ObjectId;
  employmentType: string;
  joiningDate?: string;
  status: string;
  accountActive: boolean;
  reportingManager?: ObjectId;
  team?: string;
  dob?: string;
  gender?: string;
  bloodGroup?: string;
  address?: Address;
  emergencyContact?: { name?: string; relation?: string; phone?: string };
  salary?: SalaryStructure;
  salaryHistory: SalaryRevision[];
  bank?: { accountName?: string; accountNumber?: string; ifsc?: string; bankName?: string; pan?: string; uan?: string };
  exit?: {
    resignationDate?: string;
    noticeDays?: number;
    lastWorkingDay?: string;
    reason?: string;
    stage: "none" | "notice" | "completed";
    clearanceNote?: string;
  };
  internship?: Internship;
  onboarding: OnboardingStep[];
  history: LifecycleEvent[];
  googleSub?: string;
  lastLoginAt?: Date;
  createdBy?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const MoneyLineSchema = new Schema<MoneyLine>({ name: { type: String, required: true }, amount: { type: Number, default: 0 } }, { _id: false });

const SalarySchema = new Schema<SalaryStructure>(
  {
    basic: { type: Number, default: 0, min: 0 },
    allowances: { type: [MoneyLineSchema], default: [] },
    deductions: { type: [MoneyLineSchema], default: [] },
    effectiveFrom: String,
  },
  { _id: false },
);

const SalaryRevisionSchema = new Schema<SalaryRevision>({
  basic: { type: Number, default: 0 },
  allowances: { type: [MoneyLineSchema], default: [] },
  deductions: { type: [MoneyLineSchema], default: [] },
  effectiveFrom: String,
  note: String,
  by: { type: ObjectIdType, ref: "User" },
  byName: String,
  at: { type: Date, default: Date.now },
});

const LifecycleSchema = new Schema<LifecycleEvent>({
  type: { type: String, required: true },
  date: { type: String, required: true },
  summary: { type: String, required: true },
  from: String,
  to: String,
  note: { type: String, maxlength: 1000 },
  confidential: { type: Boolean, default: false },
  by: { type: ObjectIdType, ref: "User" },
  byName: String,
  at: { type: Date, default: Date.now },
});

const ObjectiveSchema = new Schema<InternObjective>({
  text: { type: String, required: true },
  status: { type: String, enum: ["open", "in_progress", "achieved", "dropped"], default: "open" },
  note: String,
  updatedAt: Date,
});

const InternshipSchema = new Schema<Internship>(
  {
    startDate: String,
    endDate: String,
    college: String,
    course: String,
    assignedRole: String,
    mentor: { type: ObjectIdType, ref: "User" },
    objectives: { type: [ObjectiveSchema], default: [] },
    status: { type: String, enum: ["registered", "active", "extended", "completed", "terminated"], default: "registered" },
    stipend: {
      eligible: { type: Boolean, default: false },
      amount: { type: Number, default: 0 },
      period: { type: String, enum: ["monthly", "one_time"], default: "monthly" },
    },
    stipendHistory: {
      type: [
        new Schema({
          amount: Number,
          effectiveFrom: String,
          note: String,
          by: { type: ObjectIdType, ref: "User" },
          at: { type: Date, default: Date.now },
        }),
      ],
      default: [],
    },
    certificateStatus: { type: String, enum: ["none", "requested", "approved", "issued"], default: "none" },
    certificateNo: String,
    certificateIssuedAt: Date,
    certificateApprovedBy: { type: ObjectIdType, ref: "User" },
    completionNote: String,
    completedAt: Date,
  },
  { _id: false },
);

const UserSchema = new Schema<IUser>(
  {
    employeeId: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    personalEmail: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    photo: String,
    personType: { type: String, enum: ["employee", "trainee", "intern", "admin"], default: "employee", index: true },
    role: { type: String, required: true, index: true },
    isSuperAdmin: { type: Boolean, default: false },
    department: { type: ObjectIdType, ref: "Department", index: true },
    designation: { type: ObjectIdType, ref: "Designation" },
    employmentType: { type: String, default: "full_time" },
    joiningDate: String,
    status: { type: String, default: "active", index: true },
    accountActive: { type: Boolean, default: false },
    reportingManager: { type: ObjectIdType, ref: "User", index: true },
    team: String,
    dob: String,
    gender: String,
    bloodGroup: String,
    address: AddressSchema,
    emergencyContact: { name: String, relation: String, phone: String },
    salary: SalarySchema,
    salaryHistory: { type: [SalaryRevisionSchema], default: [] },
    bank: { accountName: String, accountNumber: String, ifsc: String, bankName: String, pan: String, uan: String },
    exit: {
      resignationDate: String,
      noticeDays: Number,
      lastWorkingDay: String,
      reason: String,
      stage: { type: String, enum: ["none", "notice", "completed"], default: "none" },
      clearanceNote: String,
    },
    internship: InternshipSchema,
    onboarding: {
      type: [
        new Schema<OnboardingStep>(
          {
            key: String,
            label: String,
            done: { type: Boolean, default: false },
            doneAt: Date,
            doneBy: { type: ObjectIdType, ref: "User" },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    history: { type: [LifecycleSchema], default: [] },
    googleSub: String,
    lastLoginAt: Date,
    createdBy: { type: ObjectIdType, ref: "User" },
  },
  { timestamps: true },
);

// Exactly one super admin document can exist.
UserSchema.index({ isSuperAdmin: 1 }, { unique: true, partialFilterExpression: { isSuperAdmin: true } });
UserSchema.index({ name: "text", email: "text", employeeId: "text" });

export const User = defineModel<IUser>("User", UserSchema);

/** Fields never sent to users without `staff.confidential`. */
export const CONFIDENTIAL_USER_FIELDS = ["salary", "salaryHistory", "bank"] as const;
