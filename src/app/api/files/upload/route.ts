import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { can, getCurrentUser } from "@/lib/auth/session";
import { storeFile } from "@/lib/files";
import { ALLOWED_MIME, MAX_UPLOAD_BYTES } from "@/lib/storage";
import { env } from "@/lib/env";
import { isObjectId } from "@/lib/validation";

const ENTITY_TYPES = new Set([
  "user",
  "avatar",
  "task",
  "submission",
  "project",
  "issue",
  "expense",
  "leave",
  "contract",
  "proposal",
  "client",
  "lead",
  "activity",
  "asset",
  "invoice",
  "learning",
  "company",
  "announcement",
]);

/** Leading bytes of the formats a browser could mislabel; other allowed types (text, CSV) have no reliable signature. */
const SIGNATURES: Record<string, number[][]> = {
  "image/png": [[0x89, 0x50, 0x4e, 0x47]],
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/gif": [[0x47, 0x49, 0x46, 0x38]],
  "image/webp": [[0x52, 0x49, 0x46, 0x46]],
  "application/pdf": [[0x25, 0x50, 0x44, 0x46]],
  "application/zip": [[0x50, 0x4b]],
  "application/x-zip-compressed": [[0x50, 0x4b]],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [[0x50, 0x4b]],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [[0x50, 0x4b]],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [[0x50, 0x4b]],
  "application/msword": [[0xd0, 0xcf, 0x11, 0xe0], [0x50, 0x4b]],
  "application/vnd.ms-excel": [[0xd0, 0xcf, 0x11, 0xe0], [0x50, 0x4b]],
  "application/vnd.ms-powerpoint": [[0xd0, 0xcf, 0x11, 0xe0], [0x50, 0x4b]],
};

function matchesSignature(mime: string, buffer: Buffer): boolean {
  const options = SIGNATURES[mime];
  if (!options) return true;
  return options.some((sig) => sig.every((byte, i) => buffer[i] === byte));
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  if (!env.spaces.configured) {
    return NextResponse.json({ ok: false, error: "File storage is not configured on the server." }, { status: 503 });
  }
  // Refuse oversized bodies before buffering the multipart payload (the per-file limit is checked again below).
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) return NextResponse.json({ ok: false, error: `File is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` }, { status: 413 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid upload" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "No file received" }, { status: 400 });

  const entityType = String(form.get("entityType") ?? "");
  const entityId = String(form.get("entityId") ?? "") || undefined;
  if (!ENTITY_TYPES.has(entityType)) return NextResponse.json({ ok: false, error: "Unknown upload type" }, { status: 400 });
  if (entityId && !isObjectId(entityId)) return NextResponse.json({ ok: false, error: "Invalid record" }, { status: 400 });

  const isAvatar = entityType === "avatar";
  const isCompany = entityType === "company";
  const maxBytes = isAvatar ? 3 * 1024 * 1024 : MAX_UPLOAD_BYTES;
  if (file.size === 0) return NextResponse.json({ ok: false, error: "The file is empty" }, { status: 400 });
  if (file.size > maxBytes) return NextResponse.json({ ok: false, error: `File is larger than ${maxBytes / 1024 / 1024} MB` }, { status: 413 });

  // Browser-declared type, normalised (so `image/svg+xml; charset=utf-8` cannot slip past the SVG block).
  const mime = (file.type.split(";")[0] ?? "").trim().toLowerCase() || "application/octet-stream";
  if (isAvatar || isCompany ? !mime.startsWith("image/") || mime === "image/svg+xml" : !ALLOWED_MIME.has(mime)) {
    return NextResponse.json({ ok: false, error: "This file type is not allowed" }, { status: 415 });
  }

  // Employee documents: only the person themself or users who can edit staff records.
  if (entityType === "user" && entityId !== user.id && !can(user, "staff.edit") && !can(user, "interns.manage")) {
    return NextResponse.json({ ok: false, error: "You can't upload documents for this person" }, { status: 403 });
  }
  if (isAvatar && entityId && entityId !== user.id && !can(user, "staff.edit")) {
    return NextResponse.json({ ok: false, error: "You can't change this photo" }, { status: 403 });
  }
  if (isCompany && !can(user, "settings.manage")) {
    return NextResponse.json({ ok: false, error: "Not allowed" }, { status: 403 });
  }
  // Admin-only attachment types (other types are self-service; the attach actions re-check access).
  if ((entityType === "learning" && !can(user, "interns.manage")) || (entityType === "announcement" && !can(user, "announcements.manage"))) {
    return NextResponse.json({ ok: false, error: "Not allowed" }, { status: 403 });
  }

  try {
    await connectDB();
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!matchesSignature(mime, buffer) || buffer.subarray(0, 512).toString("latin1").toLowerCase().includes("<svg")) {
      return NextResponse.json({ ok: false, error: "The file's content does not match its type" }, { status: 415 });
    }
    const expiryDate = String(form.get("expiryDate") ?? "");
    // Employee documents: category / confidentiality / expiry are only set by `registerDocument` after validation, so the
    // client-supplied values are ignored here. Until then the file stays confidential (the register step overwrites it).
    const isUserDoc = entityType === "user";
    const stored = await storeFile(user, {
      buffer,
      name: file.name || "upload",
      mime,
      entityType,
      entityId,
      category: isUserDoc ? undefined : String(form.get("category") ?? "") || undefined,
      confidential: isUserDoc || form.get("confidential") === "true",
      expiryDate: !isUserDoc && /^\d{4}-\d{2}-\d{2}$/.test(expiryDate) ? expiryDate : undefined,
      isPublic: isAvatar || isCompany,
    });
    return NextResponse.json({
      ok: true,
      file: { id: stored._id.toString(), name: stored.name, size: stored.size, mime: stored.mime, url: stored.url },
    });
  } catch (error) {
    console.error("[upload] failed", error);
    return NextResponse.json({ ok: false, error: "Upload failed. Please try again." }, { status: 500 });
  }
}
