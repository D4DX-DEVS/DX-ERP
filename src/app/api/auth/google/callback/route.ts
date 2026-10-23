import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { connectDB } from "@/lib/db";
import { exchangeGoogleCode } from "@/lib/auth/google";
import { createSession } from "@/lib/auth/session";
import { OAUTH_STATE_COOKIE, verifyToken } from "@/lib/auth/token";
import { User } from "@/lib/models";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { escapeRegex } from "@/lib/format";
import { safeNextPath } from "@/lib/safe-redirect";

function fail(code: string) {
  const res = NextResponse.redirect(new URL(`/login?error=${code}`, env.appUrl));
  res.cookies.delete({ name: OAUTH_STATE_COOKIE, path: "/api/auth/google" });
  return res;
}

/**
 * Google sign-in callback. Staff can sign in only when an account with the same email was
 * created by the Super Admin / HR and login access is enabled.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return fail("google_cancelled");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const saved = await verifyToken<{ state: string; verifier: string; nonce: string; remember: boolean; next: string }>(
    jar.get(OAUTH_STATE_COOKIE)?.value,
    "oauth",
  );
  if (!code || !state || !saved || saved.state !== state) return fail("invalid_state");

  let identity;
  try {
    identity = await exchangeGoogleCode(code, saved.verifier, saved.nonce);
  } catch (error) {
    console.error("[google] exchange failed", error);
    return fail("google_failed");
  }
  if (!identity.email || !identity.emailVerified) return fail("email_unverified");
  if (env.google.allowedDomain && identity.email.split("@")[1] !== env.google.allowedDomain) return fail("domain_not_allowed");

  await connectDB();
  const user = await User.findOne({ email: new RegExp(`^${escapeRegex(identity.email)}$`, "i") });

  if (!user || user.isSuperAdmin) {
    await audit(null, { action: "login_failed", entity: "auth", summary: `Google sign-in refused for ${identity.email} (not registered)` });
    return fail("not_registered");
  }
  if (!user.accountActive) {
    await audit({ _id: undefined, name: user.name }, { action: "login_failed", entity: "auth", entityId: user._id, summary: `Google sign-in refused for ${identity.email} (login access disabled)` });
    return fail("access_disabled");
  }
  if (["resigned", "terminated", "inactive"].includes(user.status)) {
    return fail("access_disabled");
  }
  if (user.googleSub && user.googleSub !== identity.sub) {
    // The email now belongs to a different Google account — refuse rather than silently re-link.
    await audit({ _id: undefined, name: user.name }, { action: "login_failed", entity: "auth", entityId: user._id, summary: `Google account mismatch for ${identity.email}` });
    return fail("account_mismatch");
  }

  const updates: Record<string, unknown> = { googleSub: identity.sub };
  if (!user.photo && identity.picture) updates.photo = identity.picture;
  const step = user.onboarding?.find((s) => s.key === "first_login");
  if (step && !step.done) {
    await User.updateOne({ _id: user._id, "onboarding.key": "first_login" }, { $set: { "onboarding.$.done": true, "onboarding.$.doneAt": new Date() } });
  }
  await User.updateOne({ _id: user._id }, { $set: updates });

  await createSession(user._id, "google", Boolean(saved.remember));
  await audit({ _id: user._id, name: user.name, role: user.role }, { action: "login", entity: "auth", entityId: user._id, summary: `${user.name} signed in with Google` });

  const res = NextResponse.redirect(new URL(safeNextPath(saved.next), env.appUrl));
  res.cookies.delete({ name: OAUTH_STATE_COOKIE, path: "/api/auth/google" });
  return res;
}
