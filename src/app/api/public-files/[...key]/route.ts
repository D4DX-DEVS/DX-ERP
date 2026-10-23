import { NextResponse } from "next/server";
import { getObject } from "@/lib/storage";

/**
 * Serves objects from the public R2 bucket (avatars, company logo) when no PUBLIC_FILES_URL is
 * configured. Keys are unguessable and the bucket only ever holds files uploaded as public.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/public-files/[...key]">) {
  const { key } = await ctx.params;
  const object = await getObject(key.join("/"), true);
  if (!object) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
