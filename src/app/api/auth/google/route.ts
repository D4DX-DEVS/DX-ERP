import { NextResponse } from "next/server";
import { createPkce, googleAuthUrl } from "@/lib/auth/google";
import { OAUTH_STATE_COOKIE, signToken } from "@/lib/auth/token";
import { env } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-redirect";

/** Starts the Google sign-in (authorisation code + PKCE). */
export async function GET(request: Request) {
  if (!env.google.configured) {
    return NextResponse.redirect(new URL("/login?error=google_not_configured", env.appUrl));
  }
  const url = new URL(request.url);
  const remember = url.searchParams.get("remember") === "1";
  const next = url.searchParams.get("next") ?? "";
  const { verifier, challenge, state, nonce } = createPkce();
  const expires = new Date(Date.now() + 10 * 60_000);
  const token = await signToken({ state, verifier, nonce, remember, next: safeNextPath(next, "") }, expires, "oauth");

  const res = NextResponse.redirect(googleAuthUrl({ state, challenge, nonce }));
  res.cookies.set(OAUTH_STATE_COOKIE, token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/api/auth/google",
    expires,
  });
  return res;
}
