import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Envelope encryption for the project secrets vault.
 *
 *   VAULT_MASTER_KEY (env, never stored)  ──wraps──▶  per-project data key (stored wrapped)
 *   per-project data key                  ──seals──▶  each vault item's payload
 *
 * AES-256-GCM everywhere, a fresh 96-bit IV per encryption, and additional authenticated data (AAD)
 * binding every ciphertext to its project / item / kind, so a ciphertext copied onto another record
 * fails to decrypt. Deleting a project's wrapped key crypto-shreds all of its secrets.
 */

const ALGO = "aes-256-gcm";
const VERSION = "v1";

export class VaultKeyError extends Error {}

function parseKey(raw: string, name: string): Buffer {
  const value = raw.trim();
  const buf = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (buf.length !== 32) throw new VaultKeyError(`${name} must be 32 bytes, given as 64 hex characters or base64.`);
  return buf;
}

/** Short fingerprint stored next to wrapped keys so a wrong / rotated master key is detected, not mis-decrypted. */
function fingerprint(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export interface MasterKey {
  key: Buffer;
  id: string;
}

export function vaultConfigured(): boolean {
  return Boolean(env.vault.masterKey);
}

export function currentMasterKey(): MasterKey {
  const raw = env.vault.masterKey;
  if (!raw) throw new VaultKeyError("The secrets vault is not configured. Set VAULT_MASTER_KEY on the server.");
  const key = parseKey(raw, "VAULT_MASTER_KEY");
  return { key, id: fingerprint(key) };
}

/** The previous master key (VAULT_MASTER_KEY_PREVIOUS) during a key rotation, if set. */
export function previousMasterKey(): MasterKey | null {
  const raw = env.vault.previousMasterKey;
  if (!raw) return null;
  const key = parseKey(raw, "VAULT_MASTER_KEY_PREVIOUS");
  return { key, id: fingerprint(key) };
}

export function seal(key: Buffer, plaintext: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${Buffer.concat([iv, tag, ct]).toString("base64url")}`;
}

export function unseal(key: Buffer, blob: string, aad: string): string {
  const [version, body] = blob.split(":");
  if (version !== VERSION || !body) throw new VaultKeyError("Unsupported ciphertext format.");
  const raw = Buffer.from(body, "base64url");
  if (raw.length < 28) throw new VaultKeyError("Ciphertext is truncated.");
  const decipher = createDecipheriv(ALGO, key, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(raw.subarray(12, 28));
  try {
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    throw new VaultKeyError("Secret could not be decrypted (wrong key or tampered data).");
  }
}

export function newDataKey(): Buffer {
  return randomBytes(32);
}

const dekAad = (projectId: string) => `d4dx-vault:dek:${projectId}`;

export function wrapDataKey(master: MasterKey, dek: Buffer, projectId: string): string {
  return seal(master.key, dek.toString("base64"), dekAad(projectId));
}

export function unwrapDataKey(master: MasterKey, wrapped: string, projectId: string): Buffer {
  return Buffer.from(unseal(master.key, wrapped, dekAad(projectId)), "base64");
}

export const itemAad = (projectId: string, itemId: string, kind: string) => `d4dx-vault:item:${projectId}:${itemId}:${kind}`;
