import "server-only";
import { randomBytes } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";

/** DigitalOcean Spaces (S3-compatible) storage. */
let client: S3Client | null = null;

function s3(): S3Client {
  if (!env.spaces.configured) {
    throw new Error("File storage is not configured. Set the DO_SPACES_* environment variables.");
  }
  if (!client) {
    client = new S3Client({
      endpoint: env.spaces.endpoint,
      region: env.spaces.region,
      forcePathStyle: false,
      credentials: { accessKeyId: env.spaces.key, secretAccessKey: env.spaces.secret },
    });
  }
  return client;
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

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

function safeName(name: string): string {
  const base = name.normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-").slice(-120);
  return base || "file";
}

/** Builds an object key under the configured folder: <folder>/<area>/<yyyy>/<mm>/<random>-<name> */
export function buildKey(area: string, fileName: string): string {
  const now = new Date();
  const rand = randomBytes(8).toString("hex");
  return [
    env.spaces.folder,
    area.replace(/[^a-z0-9_-]/gi, ""),
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    `${rand}-${safeName(fileName)}`,
  ]
    .filter(Boolean)
    .join("/");
}

/** Public URL (CDN when configured) for objects uploaded with `public-read`. */
export function publicUrl(key: string): string {
  if (env.spaces.cdnUrl) return `${env.spaces.cdnUrl}/${key}`;
  const endpoint = new URL(env.spaces.endpoint);
  return `${endpoint.protocol}//${env.spaces.bucket}.${endpoint.host}/${key}`;
}

export async function putObject(key: string, body: Buffer | Uint8Array, contentType: string, isPublic: boolean): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: env.spaces.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ACL: isPublic ? "public-read" : "private",
      CacheControl: isPublic ? "public, max-age=31536000, immutable" : "private, max-age=0",
    }),
  );
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const res = await s3().send(new GetObjectCommand({ Bucket: env.spaces.bucket, Key: key }));
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

export async function deleteObject(key: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: env.spaces.bucket, Key: key }));
}

/** Short-lived signed download URL for private objects. */
export async function signedDownloadUrl(key: string, fileName: string, inline = true, expiresIn = 120): Promise<string> {
  const disposition = `${inline ? "inline" : "attachment"}; filename="${safeName(fileName)}"`;
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: env.spaces.bucket, Key: key, ResponseContentDisposition: disposition }),
    { expiresIn },
  );
}
