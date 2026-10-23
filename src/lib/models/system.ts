import { defineModel, ObjectIdType, Schema, type ObjectId } from "./_base";

/** Singleton configuration document (`_id: "global"`), merged over DEFAULT_SETTINGS on read. */
export interface ISettings {
  _id: string;
  value: Record<string, unknown>;
  updatedBy?: ObjectId;
  updatedAt: Date;
}

const SettingsSchema = new Schema<ISettings>(
  {
    _id: { type: String, required: true },
    value: { type: Schema.Types.Mixed, default: {} },
    updatedBy: { type: ObjectIdType, ref: "User" },
  },
  { timestamps: { createdAt: false, updatedAt: true }, minimize: false },
);

export const Settings = defineModel<ISettings>("Settings", SettingsSchema);

/** Atomic sequence numbers for human-readable IDs (EMP-0001, MOV-000123, INV-2026-27-0001 …). */
export interface ICounter {
  _id: string;
  seq: number;
}

const CounterSchema = new Schema<ICounter>({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

export const Counter = defineModel<ICounter>("Counter", CounterSchema);

export interface ISession {
  _id: ObjectId;
  sid: string;
  user: ObjectId;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  ip?: string;
  userAgent?: string;
  method: "google" | "password";
  revokedAt?: Date;
  revokedReason?: string;
}

const SessionSchema = new Schema<ISession>({
  sid: { type: String, required: true, unique: true },
  user: { type: ObjectIdType, ref: "User", required: true, index: true },
  createdAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  ip: String,
  userAgent: String,
  method: { type: String, enum: ["google", "password"], required: true },
  revokedAt: Date,
  revokedReason: String,
});
// Expired sessions are purged automatically one day after expiry.
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86_400 });

export const Session = defineModel<ISession>("Session", SessionSchema);

/** Failed sign-in attempts for rate limiting (auto-expire after 1 hour). */
export interface ILoginAttempt {
  _id: ObjectId;
  key: string;
  at: Date;
}

const LoginAttemptSchema = new Schema<ILoginAttempt>({
  key: { type: String, required: true, index: true },
  at: { type: Date, default: Date.now },
});
LoginAttemptSchema.index({ at: 1 }, { expireAfterSeconds: 3600 });

export const LoginAttempt = defineModel<ILoginAttempt>("LoginAttempt", LoginAttemptSchema);

/** Lock + last-run bookkeeping for scheduled jobs (reminders, backups, retention). */
export interface ISystemJob {
  _id: string;
  lastRunAt?: Date;
  lockedUntil?: Date;
  lastResult?: string;
}

const SystemJobSchema = new Schema<ISystemJob>({
  _id: { type: String, required: true },
  lastRunAt: Date,
  lockedUntil: Date,
  lastResult: String,
});

export const SystemJob = defineModel<ISystemJob>("SystemJob", SystemJobSchema);

export interface IAuditLog {
  _id: ObjectId;
  actor?: ObjectId;
  actorName: string;
  actorRole?: string;
  action: string;
  entity: string;
  entityId?: string;
  ref?: string;
  summary: string;
  changes?: { field: string; from?: string; to?: string }[];
  ip?: string;
  userAgent?: string;
  at: Date;
}

const AuditLogSchema = new Schema<IAuditLog>({
  actor: { type: ObjectIdType, ref: "User", index: true },
  actorName: { type: String, required: true },
  actorRole: String,
  action: { type: String, required: true, index: true },
  entity: { type: String, required: true, index: true },
  entityId: { type: String, index: true },
  ref: String,
  summary: { type: String, required: true },
  changes: {
    type: [new Schema({ field: String, from: String, to: String }, { _id: false })],
    default: undefined,
  },
  ip: String,
  userAgent: String,
  at: { type: Date, default: Date.now, index: true },
});

export const AuditLog = defineModel<IAuditLog>("AuditLog", AuditLogSchema);

export interface IStoredFile {
  _id: ObjectId;
  key: string;
  name: string;
  size: number;
  mime: string;
  /** Public files (avatars, company logo) are served from the CDN; everything else via signed URLs. */
  isPublic: boolean;
  url?: string;
  entityType: string;
  entityId?: string;
  category?: string;
  confidential: boolean;
  expiryDate?: string;
  notes?: string;
  version: number;
  replaces?: ObjectId;
  replacedBy?: ObjectId;
  uploadedBy?: ObjectId;
  uploadedByName?: string;
  deletedAt?: Date;
  deletedBy?: ObjectId;
  createdAt: Date;
}

const StoredFileSchema = new Schema<IStoredFile>(
  {
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    size: { type: Number, default: 0 },
    mime: { type: String, default: "application/octet-stream" },
    isPublic: { type: Boolean, default: false },
    url: String,
    entityType: { type: String, required: true, index: true },
    entityId: { type: String, index: true },
    category: String,
    confidential: { type: Boolean, default: false },
    expiryDate: String,
    notes: String,
    version: { type: Number, default: 1 },
    replaces: { type: ObjectIdType, ref: "StoredFile" },
    replacedBy: { type: ObjectIdType, ref: "StoredFile" },
    uploadedBy: { type: ObjectIdType, ref: "User" },
    uploadedByName: String,
    deletedAt: Date,
    deletedBy: { type: ObjectIdType, ref: "User" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const StoredFile = defineModel<IStoredFile>("StoredFile", StoredFileSchema);

export interface IBackup {
  _id: ObjectId;
  key: string;
  size: number;
  collections: { name: string; count: number }[];
  trigger: "manual" | "scheduled" | "pre_restore";
  by?: ObjectId;
  byName?: string;
  status: "completed" | "failed";
  error?: string;
  restoredAt?: Date;
  restoredBy?: string;
  createdAt: Date;
}

const BackupSchema = new Schema<IBackup>(
  {
    key: { type: String, required: true },
    size: { type: Number, default: 0 },
    collections: { type: [new Schema({ name: String, count: Number }, { _id: false })], default: [] },
    trigger: { type: String, enum: ["manual", "scheduled", "pre_restore"], default: "manual" },
    by: { type: ObjectIdType, ref: "User" },
    byName: String,
    status: { type: String, enum: ["completed", "failed"], default: "completed" },
    error: String,
    restoredAt: Date,
    restoredBy: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const Backup = defineModel<IBackup>("Backup", BackupSchema);
