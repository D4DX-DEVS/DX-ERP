"use server";

import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { ActionError, actionUser, parse, runAction, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/audit";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { CREDENTIAL_CATEGORIES, Credential, VaultEvent, newId, type ICredential } from "@/lib/models";
import { inList } from "@/lib/sql";
import { isObjectId, zs } from "@/lib/validation";
import { COMPANY_VAULT, companyDataKey, openCredential, sealCredential, type CredentialSecret } from "@/lib/vault/credentials";
import { VaultKeyError } from "@/lib/vault/crypto";
import { logVaultEvent, REVEAL_ACTIONS } from "@/lib/vault/service";

const MAX_CREDENTIALS = 1000;
/** Reveals per 10 minutes before further requests are refused (protects against a stolen session scraping everything). */
const REVEAL_LIMIT = 120;

/** Only the single env-configured super admin may use credential storage. */
async function superAdmin(): Promise<CurrentUser> {
  const user = await actionUser();
  if (!user.isSuperAdmin) throw new ActionError("Only the Super Admin can use credential storage.");
  return user;
}

async function key(): Promise<Buffer> {
  try {
    return await companyDataKey();
  } catch (error) {
    if (error instanceof VaultKeyError) throw new ActionError(error.message);
    throw error;
  }
}

function open(k: Buffer, row: ICredential): CredentialSecret {
  try {
    return openCredential(k, row);
  } catch (error) {
    if (error instanceof VaultKeyError) throw new ActionError(error.message);
    throw error;
  }
}

async function loadCredential(id: string): Promise<ICredential> {
  if (!isObjectId(id)) throw new ActionError("Credential not found.");
  const [row] = await db().select().from(Credential).where(eq(Credential._id, id)).limit(1);
  if (!row) throw new ActionError("Credential not found.");
  return row;
}

/** Raw (untrimmed) string: passwords may legitimately start or end with spaces. */
const raw = (max: number, message: string) => z.preprocess((v) => (typeof v === "string" ? v : ""), z.string().max(max, message));

const schema = z.object({
  id: zs.optId(),
  platform: zs.text("Platform", 120),
  category: z.enum(CREDENTIAL_CATEGORIES, { error: "Choose a category" }),
  url: zs.optText(500),
  username: zs.optText(300),
  password: raw(2000, "Password is too long"),
  notes: zs.optText(5000),
});

export async function saveCredential(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await superAdmin();
    const data = parse(schema, input);
    if (data.url && /^[a-z][a-z0-9+.-]*:\/\//i.test(data.url)) {
      let u: URL;
      try {
        u = new URL(data.url);
      } catch {
        throw new ActionError("Enter a valid web address.", { url: "Invalid URL" });
      }
      // The URL is listed without a reveal, so it must not carry secrets.
      if (u.username || u.password) throw new ActionError("Keep the username and password out of the URL.", { url: "Remove the user:password@ part" });
    }
    const k = await key();

    if (data.id) {
      const existing = await loadCredential(data.id);
      const current = open(k, existing);
      // An empty password field keeps the stored password.
      const secret: CredentialSecret = { username: data.username, password: data.password !== "" ? data.password : current.password, notes: data.notes };
      const valuesChanged = secret.username !== current.username || secret.password !== current.password || secret.notes !== current.notes;
      await db()
        .update(Credential)
        .set({
          platform: data.platform,
          category: data.category,
          url: data.url ?? null,
          ciphertext: sealCredential(k, existing._id, secret),
          updatedBy: user._id,
          ...(valuesChanged ? { valuesUpdatedAt: new Date() } : {}),
        })
        .where(eq(Credential._id, existing._id));
      await logVaultEvent(user, { project: COMPANY_VAULT, item: existing._id, itemName: data.platform, action: "update" });
      await audit(user, {
        action: "update",
        entity: "credential",
        entityId: existing._id,
        ref: data.platform,
        summary: `Updated stored credential for ${data.platform}${secret.password !== current.password ? " (password changed)" : ""}`,
      });
      return { id: existing._id };
    }

    if (!data.password) throw new ActionError("Enter the password.", { password: "Required" });
    const count = await db().$count(Credential);
    if (count >= MAX_CREDENTIALS) throw new ActionError(`Credential storage is full (${MAX_CREDENTIALS} entries).`);
    const id = newId();
    await db()
      .insert(Credential)
      .values({
        _id: id,
        platform: data.platform,
        category: data.category,
        url: data.url,
        ciphertext: sealCredential(k, id, { username: data.username, password: data.password, notes: data.notes }),
        createdBy: user._id,
        updatedBy: user._id,
      });
    await logVaultEvent(user, { project: COMPANY_VAULT, item: id, itemName: data.platform, action: "create" });
    await audit(user, { action: "create", entity: "credential", entityId: id, ref: data.platform, summary: `Stored a credential for ${data.platform}` });
    return { id };
  }, "Credential saved");
}

/** Decrypts one credential for display, copy or editing. Every call is logged. */
export async function revealCredential(id: string, purpose: "reveal" | "copy" | "edit_open" = "reveal"): Promise<ActionResult<CredentialSecret>> {
  return runAction(async () => {
    const user = await superAdmin();
    const action = (["reveal", "copy", "edit_open"] as const).includes(purpose) ? purpose : "reveal";
    const recent = await db().$count(
      VaultEvent,
      and(eq(VaultEvent.project, COMPANY_VAULT), eq(VaultEvent.user, user._id), inList(VaultEvent.action, REVEAL_ACTIONS), gt(VaultEvent.at, new Date(Date.now() - 10 * 60_000))),
    );
    if (recent >= REVEAL_LIMIT) throw new ActionError("Too many reveals in a short time. Wait a few minutes and try again.");
    const row = await loadCredential(id);
    const secret = open(await key(), row);
    await logVaultEvent(user, { project: COMPANY_VAULT, item: row._id, itemName: row.platform, action });
    return secret;
  });
}

export async function deleteCredential(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await superAdmin();
    const row = await loadCredential(id);
    await db().delete(Credential).where(eq(Credential._id, row._id));
    await logVaultEvent(user, { project: COMPANY_VAULT, item: row._id, itemName: row.platform, action: "delete" });
    await audit(user, { action: "delete", entity: "credential", entityId: row._id, ref: row.platform, summary: `Deleted the stored credential for ${row.platform}` });
    return null;
  }, "Credential deleted");
}
