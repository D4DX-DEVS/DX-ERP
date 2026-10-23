import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { can, getCurrentUser } from "@/lib/auth/session";
import { backupFileName } from "@/lib/backup";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { Backup } from "@/lib/models";
import { contentDisposition, getObject } from "@/lib/storage";
import { isObjectId } from "@/lib/validation";

/** Backup download: backup.manage only. Streams the private R2 object and audits the download. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!can(user, "backup.manage")) return new NextResponse("You don't have permission to download backups.", { status: 403 });
  if (!isObjectId(id)) return new NextResponse("Not found", { status: 404 });
  if (!env.storage.configured) return new NextResponse("File storage is not configured.", { status: 503 });

  const [backup] = await db().select().from(Backup).where(eq(Backup._id, id)).limit(1);
  if (!backup || backup.status !== "completed") return new NextResponse("Not found", { status: 404 });

  try {
    const name = backupFileName(backup.key);
    const object = await getObject(backup.key);
    if (!object) return new NextResponse("Not found", { status: 404 });
    await audit(user, { action: "export", entity: "backup", entityId: backup._id, ref: name, summary: `Downloaded backup ${name}` });
    return new NextResponse(object.body, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": contentDisposition(name, false),
        "Content-Length": String(object.size),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[backup] read failed", error);
    return new NextResponse("File storage is unavailable.", { status: 503 });
  }
}
