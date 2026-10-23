import { NextResponse } from "next/server";
import { destroySession, getCurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";

/** POST-only sign out (avoids logout via cross-site GET). */
export async function POST() {
  const user = await getCurrentUser();
  if (user) await audit(user, { action: "logout", entity: "auth", entityId: user.id, summary: `${user.name} signed out` });
  await destroySession();
  return NextResponse.redirect(new URL("/login", env.appUrl), { status: 303 });
}
