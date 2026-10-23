import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { canAccessFile } from "@/lib/files";
import { StoredFile } from "@/lib/models";
import { contentDisposition, getObject } from "@/lib/storage";
import { isObjectId } from "@/lib/validation";

/** Access-checked download: streams the object from R2 (public files redirect to their public URL). */
export async function GET(request: Request, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!isObjectId(id)) return new NextResponse("Not found", { status: 404 });

  const [file] = await db().select().from(StoredFile).where(eq(StoredFile._id, id)).limit(1);
  if (!file || file.deletedAt) return new NextResponse("Not found", { status: 404 });
  if (!(await canAccessFile(user, file))) return new NextResponse("You don't have access to this file.", { status: 403 });

  if (file.isPublic && file.url) return NextResponse.redirect(new URL(file.url, request.url));
  const download = new URL(request.url).searchParams.get("download") === "1";
  try {
    const object = await getObject(file.key, file.isPublic);
    if (!object) return new NextResponse("Not found", { status: 404 });
    return new NextResponse(object.body, {
      headers: {
        "Content-Type": file.mime || "application/octet-stream",
        "Content-Disposition": contentDisposition(file.name, !download),
        "Content-Length": String(object.size),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[files] read failed", error);
    return new NextResponse("File storage is unavailable.", { status: 503 });
  }
}
