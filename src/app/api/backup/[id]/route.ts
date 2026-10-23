import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { can, getCurrentUser } from "@/lib/auth/session";
import { backupFileName } from "@/lib/backup";
import { connectDB } from "@/lib/db";
import { env } from "@/lib/env";
import { Backup } from "@/lib/models";
import { signedDownloadUrl } from "@/lib/storage";
import { isObjectId } from "@/lib/validation";

/** Backup download: backup.manage only. Redirects to a short-lived signed URL and audits the download. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!can(user, "backup.manage")) return new NextResponse("You don't have permission to download backups.", { status: 403 });
  if (!isObjectId(id)) return new NextResponse("Not found", { status: 404 });
  if (!env.spaces.configured) return new NextResponse("File storage is not configured.", { status: 503 });

  await connectDB();
  const backup = await Backup.findById(id).lean();
  if (!backup || backup.status !== "completed") return new NextResponse("Not found", { status: 404 });

  try {
    const name = backupFileName(backup.key);
    const url = await signedDownloadUrl(backup.key, name, false, 120);
    await audit(user, { action: "export", entity: "backup", entityId: backup._id, ref: name, summary: `Downloaded backup ${name}` });
    const res = NextResponse.redirect(url);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (error) {
    console.error("[backup] sign failed", error);
    return new NextResponse("File storage is unavailable.", { status: 503 });
  }
}
