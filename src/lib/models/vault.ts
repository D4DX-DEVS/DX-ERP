import { index, sqliteTable, uniqueIndex } from "drizzle-orm/sqlite-core";
import { bool, date, int, json, pk, ref, text, timestamps, type Id } from "./_base";

/**
 * Project secrets vault. Secret values are only ever stored encrypted (see lib/vault/crypto.ts):
 * `ProjectVault` holds the project's data key wrapped by the server master key, `VaultItem.ciphertext`
 * holds the item's payload sealed with that data key. Names, environments and access settings are
 * plain metadata; variable names, URLs, usernames, passwords and notes live inside the ciphertext.
 */

export const ProjectVault = sqliteTable(
  "projectvaults",
  {
    _id: pk(),
    project: ref().notNull(),
    wrappedKey: text().notNull(),
    /** Fingerprint of the master key that wrapped `wrappedKey`. */
    masterKeyId: text().notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("projectvaults_project").on(t.project)],
);
export type IProjectVault = typeof ProjectVault.$inferSelect;

export const VAULT_KINDS = ["env", "credential", "note"] as const;
export type VaultKind = (typeof VAULT_KINDS)[number];

export const VAULT_ENVIRONMENTS = ["development", "staging", "testing", "production", "other"] as const;
export type VaultEnvironment = (typeof VAULT_ENVIRONMENTS)[number];

/** "team": the project manager and every team member. "selected": the manager plus the chosen members. */
export type VaultAudience = "team" | "selected";

/** Writes must trim `name`. */
export const VaultItem = sqliteTable(
  "vaultitems",
  {
    _id: pk(),
    project: ref().notNull(),
    kind: text().$type<VaultKind>().notNull(),
    name: text().notNull(),
    description: text(),
    environment: text().$type<VaultEnvironment>(),
    ciphertext: text().notNull(),
    /** Number of variables (env files) — shown without decrypting. */
    entryCount: int().notNull().default(0),
    audience: text().$type<VaultAudience>().notNull().default("team"),
    members: json<Id[]>()
      .notNull()
      .$defaultFn(() => []),
    /** Notify the project manager and the item's creator whenever someone reveals, copies or downloads it. */
    notifyOnReveal: bool().notNull().default(false),
    /** Planned rotation date (yyyy-MM-dd). */
    rotateBy: text(),
    /** Set when someone who accessed the secret lost access (e.g. left the team); cleared when values change. */
    rotationAdvisedAt: date(),
    rotationAdvisedReason: text(),
    version: int().notNull().default(1),
    valuesUpdatedAt: date()
      .notNull()
      .$defaultFn(() => new Date()),
    createdBy: ref().notNull(),
    updatedBy: ref(),
    ...timestamps(),
  },
  (t) => [index("vaultitems_project").on(t.project), index("vaultitems_project_kind_name").on(t.project, t.kind, t.name)],
);
export type IVaultItem = typeof VaultItem.$inferSelect;

export const VAULT_EVENT_ACTIONS = ["create", "update", "delete", "access", "reveal", "copy", "download", "edit_open"] as const;
export type VaultEventAction = (typeof VAULT_EVENT_ACTIONS)[number];

/** Append-only access log for vault items (who revealed / copied / downloaded what, and when). */
export const VaultEvent = sqliteTable(
  "vaultevents",
  {
    _id: pk(),
    project: ref().notNull(),
    item: ref(),
    itemName: text().notNull(),
    /** Variable / field name for single-value reveals (never the value). */
    field: text(),
    action: text().$type<VaultEventAction>().notNull(),
    user: ref().notNull(),
    userName: text().notNull(),
    ip: text(),
    userAgent: text(),
    at: date()
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("vaultevents_project").on(t.project),
    index("vaultevents_item").on(t.item),
    index("vaultevents_user").on(t.user),
    index("vaultevents_at").on(t.at),
  ],
);
export type IVaultEvent = typeof VaultEvent.$inferSelect;
