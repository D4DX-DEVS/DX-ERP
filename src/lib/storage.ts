import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { env } from "@/lib/env";

/**
 * Cloudflare R2 storage via Worker bindings: `FILES` (private — documents, receipts, backups; only
 * ever streamed through an access-checked route) and `PUBLIC_FILES` (avatars, company logo).
 */
function bucket(isPublic: boolean): R2Bucket {
  const bindings = getCloudflareContext().env;
  const b = isPublic ? bindings.PUBLIC_FILES : bindings.FILES;
  if (!b) throw new Error("File storage is not configured. Add the FILES and PUBLIC_FILES R2 bindings in wrangler.jsonc.");
  return b;
}

export { MAX_UPLOAD_BYTES } from "@/lib/upload-limit";

export const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/x-zip-compressed",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export function safeName(name: string): string {
  const base = name.normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-").slice(-120);
  return base || "file";
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Builds an object key under the configured folder: <folder>/<area>/<yyyy>/<mm>/<random>-<name> */
export function buildKey(area: string, fileName: string): string {
  const now = new Date();
  return [
    env.storage.folder,
    area.replace(/[^a-z0-9_-]/gi, ""),
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    `${randomHex(8)}-${safeName(fileName)}`,
  ]
    .filter(Boolean)
    .join("/");
}

/** URL for objects in the public bucket: its public domain when configured, else the app's streaming route. */
export function publicUrl(key: string): string {
  const base = env.storage.publicUrl;
  return base ? `${base}/${key}` : `/api/public-files/${key}`;
}

export async function putObject(key: string, body: Uint8Array | ArrayBuffer, contentType: string, isPublic: boolean): Promise<void> {
  await bucket(isPublic).put(key, body, {
    httpMetadata: {
      contentType,
      cacheControl: isPublic ? "public, max-age=31536000, immutable" : "private, max-age=0",
    },
  });
}

/** Object body + metadata for streaming, or null when missing. */
export async function getObject(key: string, isPublic = false): Promise<R2ObjectBody | null> {
  return bucket(isPublic).get(key);
}

export async function getObjectBuffer(key: string, isPublic = false): Promise<Uint8Array> {
  const object = await getObject(key, isPublic);
  if (!object) throw new Error(`Object not found: ${key}`);
  return new Uint8Array(await object.arrayBuffer());
}

export async function deleteObject(key: string, isPublic = false): Promise<void> {
  await bucket(isPublic).delete(key);
}

/** `Content-Disposition` value for a download (inline preview or attachment). */
export function contentDisposition(fileName: string, inline: boolean): string {
  return `${inline ? "inline" : "attachment"}; filename="${safeName(fileName)}"`;
}
