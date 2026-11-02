import "server-only";
import type { ICredential } from "@/lib/models";
import { openPayload, projectDataKey, sealPayload } from "./service";

/**
 * Company credential storage (super admin only). Reuses the vault's envelope encryption: the "company" data key is
 * stored like a project's (ProjectVault row with `project = "company"`, wrapped by VAULT_MASTER_KEY, re-wrapped on
 * key rotation) and every credential's username / password / notes are sealed together with AAD bound to its id.
 * Access-log rows go to VaultEvent under the same "company" scope.
 */
export const COMPANY_VAULT = "company";

export interface CredentialSecret {
  username?: string;
  password: string;
  notes?: string;
}

export async function companyDataKey(): Promise<Buffer> {
  const key = await projectDataKey(COMPANY_VAULT, true);
  if (!key) throw new Error("Company vault key could not be created.");
  return key;
}

export function sealCredential(key: Buffer, id: string, secret: CredentialSecret): string {
  return sealPayload(key, COMPANY_VAULT, id, { kind: "credential", username: secret.username, password: secret.password, notes: secret.notes });
}

export function openCredential(key: Buffer, row: Pick<ICredential, "_id" | "ciphertext">): CredentialSecret {
  const payload = openPayload(key, { _id: row._id, project: COMPANY_VAULT, kind: "credential", ciphertext: row.ciphertext });
  if (payload.kind !== "credential") throw new Error("Unexpected payload");
  return { username: payload.username, password: payload.password, notes: payload.notes };
}
