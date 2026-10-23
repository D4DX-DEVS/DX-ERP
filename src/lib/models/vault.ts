import { defineModel, ObjectIdType, Schema, type ObjectId } from "./_base";

/**
 * Project secrets vault. Secret values are only ever stored encrypted (see lib/vault/crypto.ts):
 * `ProjectVault` holds the project's data key wrapped by the server master key, `VaultItem.ciphertext`
 * holds the item's payload sealed with that data key. Names, environments and access settings are
 * plain metadata; variable names, URLs, usernames, passwords and notes live inside the ciphertext.
 */

export interface IProjectVault {
  _id: ObjectId;
  project: ObjectId;
  wrappedKey: string;
  /** Fingerprint of the master key that wrapped `wrappedKey`. */
  masterKeyId: string;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectVaultSchema = new Schema<IProjectVault>(
  {
    project: { type: ObjectIdType, ref: "Project", required: true, unique: true },
    wrappedKey: { type: String, required: true },
    masterKeyId: { type: String, required: true },
  },
  { timestamps: true },
);

export const ProjectVault = defineModel<IProjectVault>("ProjectVault", ProjectVaultSchema);

export const VAULT_KINDS = ["env", "credential", "note"] as const;
export type VaultKind = (typeof VAULT_KINDS)[number];

export const VAULT_ENVIRONMENTS = ["development", "staging", "testing", "production", "other"] as const;
export type VaultEnvironment = (typeof VAULT_ENVIRONMENTS)[number];

/** "team": the project manager and every team member. "selected": the manager plus the chosen members. */
export type VaultAudience = "team" | "selected";

export interface IVaultItem {
  _id: ObjectId;
  project: ObjectId;
  kind: VaultKind;
  name: string;
  description?: string;
  environment?: VaultEnvironment;
  ciphertext: string;
  /** Number of variables (env files) — shown without decrypting. */
  entryCount: number;
  audience: VaultAudience;
  members: ObjectId[];
  /** Notify the project manager and the item's creator whenever someone reveals, copies or downloads it. */
  notifyOnReveal: boolean;
  /** Planned rotation date (yyyy-MM-dd). */
  rotateBy?: string;
  /** Set when someone who accessed the secret lost access (e.g. left the team); cleared when values change. */
  rotationAdvisedAt?: Date;
  rotationAdvisedReason?: string;
  version: number;
  valuesUpdatedAt: Date;
  createdBy: ObjectId;
  updatedBy?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const VaultItemSchema = new Schema<IVaultItem>(
  {
    project: { type: ObjectIdType, ref: "Project", required: true, index: true },
    kind: { type: String, enum: VAULT_KINDS, required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, maxlength: 300 },
    environment: { type: String, enum: VAULT_ENVIRONMENTS },
    ciphertext: { type: String, required: true },
    entryCount: { type: Number, default: 0 },
    audience: { type: String, enum: ["team", "selected"], default: "team" },
    members: { type: [{ type: ObjectIdType, ref: "User" }], default: [] },
    notifyOnReveal: { type: Boolean, default: false },
    rotateBy: String,
    rotationAdvisedAt: Date,
    rotationAdvisedReason: String,
    version: { type: Number, default: 1 },
    valuesUpdatedAt: { type: Date, default: Date.now },
    createdBy: { type: ObjectIdType, ref: "User", required: true },
    updatedBy: { type: ObjectIdType, ref: "User" },
  },
  { timestamps: true },
);
VaultItemSchema.index({ project: 1, kind: 1, name: 1 });

export const VaultItem = defineModel<IVaultItem>("VaultItem", VaultItemSchema);

export const VAULT_EVENT_ACTIONS = ["create", "update", "delete", "access", "reveal", "copy", "download", "edit_open"] as const;
export type VaultEventAction = (typeof VAULT_EVENT_ACTIONS)[number];

/** Append-only access log for vault items (who revealed / copied / downloaded what, and when). */
export interface IVaultEvent {
  _id: ObjectId;
  project: ObjectId;
  item?: ObjectId;
  itemName: string;
  /** Variable / field name for single-value reveals (never the value). */
  field?: string;
  action: VaultEventAction;
  user: ObjectId;
  userName: string;
  ip?: string;
  userAgent?: string;
  at: Date;
}

const VaultEventSchema = new Schema<IVaultEvent>({
  project: { type: ObjectIdType, ref: "Project", required: true, index: true },
  item: { type: ObjectIdType, ref: "VaultItem", index: true },
  itemName: { type: String, required: true },
  field: String,
  action: { type: String, enum: VAULT_EVENT_ACTIONS, required: true },
  user: { type: ObjectIdType, ref: "User", required: true, index: true },
  userName: { type: String, required: true },
  ip: String,
  userAgent: String,
  at: { type: Date, default: Date.now, index: true },
});

export const VaultEvent = defineModel<IVaultEvent>("VaultEvent", VaultEventSchema);
