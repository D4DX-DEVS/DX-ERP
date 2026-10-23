import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Notification } from "@/lib/models";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ count: 0 }, { status: 401 });
  await connectDB();
  const count = await Notification.countDocuments({ user: user._id, read: false });
  return NextResponse.json({ count }, { headers: { "Cache-Control": "no-store" } });
}
