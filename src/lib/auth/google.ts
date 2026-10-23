import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "@/lib/env";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export function googleRedirectUri(): string {
  return `${env.appUrl}/api/auth/google/callback`;
}

export function createPkce(): { verifier: string; challenge: string; state: string; nonce: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge, state: randomBytes(24).toString("base64url"), nonce: randomBytes(16).toString("base64url") };
}

export function googleAuthUrl(params: { state: string; challenge: string; nonce: string; loginHint?: string }): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", env.google.clientId);
  url.searchParams.set("redirect_uri", googleRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", params.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("access_type", "online");
  if (env.google.allowedDomain) url.searchParams.set("hd", env.google.allowedDomain);
  if (params.loginHint) url.searchParams.set("login_hint", params.loginHint);
  return url.toString();
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
  hd?: string;
}

/** Exchanges the authorisation code and verifies the ID token signature, audience and nonce. */
export async function exchangeGoogleCode(code: string, verifier: string, nonce: string): Promise<GoogleIdentity> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.google.clientId,
      client_secret: env.google.clientSecret,
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google token exchange failed (${res.status}) ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { id_token?: string };
  if (!json.id_token) throw new Error("Google did not return an ID token");

  const { payload } = await jwtVerify(json.id_token, GOOGLE_JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: env.google.clientId,
  });
  if (payload.nonce !== nonce) throw new Error("Invalid sign-in nonce");

  return {
    sub: String(payload.sub),
    email: String(payload.email ?? "").toLowerCase(),
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
    name: typeof payload.name === "string" ? payload.name : undefined,
    picture: typeof payload.picture === "string" ? payload.picture : undefined,
    hd: typeof payload.hd === "string" ? payload.hd : undefined,
  };
}
