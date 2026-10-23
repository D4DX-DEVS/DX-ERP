import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { canAccessFile } from "@/lib/files";
import { StoredFile } from "@/lib/models";
import { signedDownloadUrl } from "@/lib/storage";
import { isObjectId } from "@/lib/validation";

/** Access-checked download: redirects to a short-lived signed URL (or the CDN for public files). */
export async function GET(request: Request, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!isObjectId(id)) return new NextResponse("Not found", { status: 404 });

  await connectDB();
  const file = await StoredFile.findById(id).lean();
  if (!file || file.deletedAt) return new NextResponse("Not found", { status: 404 });
  if (!(await canAccessFile(user, file))) return new NextResponse("You don't have access to this file.", { status: 403 });

  if (file.isPublic && file.url) return NextResponse.redirect(file.url);
  const download = new URL(request.url).searchParams.get("download") === "1";
  try {
    const url = await signedDownloadUrl(file.key, file.name, !download);
    return NextResponse.redirect(url);
  } catch (error) {
    console.error("[files] sign failed", error);
    return new NextResponse("File storage is unavailable.", { status: 503 });
  }
}
