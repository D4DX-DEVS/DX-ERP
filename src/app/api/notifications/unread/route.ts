import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Notification } from "@/lib/models";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ count: 0 }, { status: 401 });
  const count = await db().$count(Notification, and(eq(Notification.user, user._id), eq(Notification.read, false)));
  return NextResponse.json({ count }, { headers: { "Cache-Control": "no-store" } });
}
