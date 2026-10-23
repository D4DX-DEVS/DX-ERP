import { SignJWT, jwtVerify } from "jose";

/** Session cookie name and JWT helpers. Kept free of DB imports so `proxy.ts` can use it. */
// `__Host-` cookies can only be set over HTTPS with Secure, Path=/ and no Domain — exactly how these are set in production.
const HOST_PREFIX = process.env.NODE_ENV === "production" ? "__Host-" : "";
export const SESSION_COOKIE = `${HOST_PREFIX}dx_session`;
export const PENDING_2FA_COOKIE = `${HOST_PREFIX}dx_2fa`;
export const OAUTH_STATE_COOKIE = "dx_oauth";

export interface SessionClaims {
  sid: string;
  uid: string;
}

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must be set (at least 32 characters)");
  return new TextEncoder().encode(secret);
}

export async function signToken(payload: Record<string, unknown>, expiresAt: Date, audience = "session"): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("dx-erp")
    .setAudience(audience)
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secretKey());
}

export async function verifyToken<T extends Record<string, unknown>>(token: string | undefined, audience = "session"): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: "dx-erp", audience });
    return payload as T;
  } catch {
    return null;
  }
}
