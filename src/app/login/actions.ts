"use server";

import { cookies } from "next/headers";
import { connectDB } from "@/lib/db";
import { env } from "@/lib/env";
import { LoginAttempt, User } from "@/lib/models";
import { createSession, requestMeta } from "@/lib/auth/session";
import { safeEqual, verifyPasswordHash, verifyTotp } from "@/lib/auth/password";
import { PENDING_2FA_COOKIE, signToken, verifyToken } from "@/lib/auth/token";
import { audit } from "@/lib/audit";
import { ensureSeeded } from "@/lib/seed";
import { safeNextPath } from "@/lib/safe-redirect";
import type { ActionResult } from "@/lib/action-result";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60_000;

function safeNext(next: unknown): string {
  return safeNextPath(typeof next === "string" ? next : undefined);
}

async function tooManyAttempts(keys: string[]): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS);
  const count = await LoginAttempt.countDocuments({ key: { $in: keys }, at: { $gte: since } });
  return count >= MAX_ATTEMPTS;
}

/** Creates or updates the single Super Admin account from the environment configuration. */
async function upsertSuperAdmin() {
  const email = env.superAdmin.email;
  const clash = await User.findOne({ email, isSuperAdmin: { $ne: true } }, { _id: 1 }).lean();
  if (clash) throw new Error("SUPER_ADMIN_EMAIL is already used by a staff account. Use a different email for the Super Admin.");
  const existing = await User.findOne({ isSuperAdmin: true });
  if (existing) {
    if (existing.email !== email || existing.name !== env.superAdmin.name) {
      existing.email = email;
      existing.name = env.superAdmin.name;
      await existing.save();
    }
    return existing;
  }
  return User.create({
    employeeId: "ADM-0001",
    name: env.superAdmin.name,
    email,
    personType: "admin",
    role: "super_admin",
    isSuperAdmin: true,
    accountActive: true,
    status: "active",
    employmentType: "full_time",
  });
}

async function completeLogin(remember: boolean): Promise<void> {
  await ensureSeeded();
  const admin = await upsertSuperAdmin();
  await createSession(admin._id, "password", remember);
  await audit({ _id: admin._id, name: admin.name, role: "super_admin" }, { action: "login", entity: "auth", entityId: admin._id, summary: "Super Admin signed in" });
}

export async function superAdminSignIn(input: Record<string, unknown>): Promise<ActionResult<{ next: string }>> {
  try {
    await connectDB();
    const email = String(input.email ?? "").trim().toLowerCase();
    const password = String(input.password ?? "");
    const remember = input.remember === "on" || input.remember === true;
    if (!email || !password) return { ok: false, error: "Enter your email and password.", fieldErrors: { ...(email ? {} : { email: "Required" }), ...(password ? {} : { password: "Required" }) } };

    const { ip } = await requestMeta();
    const keys = [`email:${email}`, `ip:${ip ?? "unknown"}`];
    if (await tooManyAttempts(keys)) {
      return { ok: false, error: "Too many failed attempts. Try again in 15 minutes." };
    }

    let configured = true;
    let validPassword = false;
    try {
      const expectedEmail = env.superAdmin.email;
      const hash = env.superAdmin.passwordHash;
      const plain = env.superAdmin.password;
      if (!hash && !plain) configured = false;
      // Always run both comparisons so a wrong email takes as long as a wrong password.
      const emailOk = safeEqual(email, expectedEmail);
      const passwordOk = hash ? verifyPasswordHash(password, hash) : safeEqual(password, plain);
      validPassword = emailOk && passwordOk;
    } catch {
      configured = false;
    }
    if (!configured) return { ok: false, error: "Super Admin sign-in is not configured on the server." };

    if (!validPassword) {
      await LoginAttempt.insertMany(keys.map((key) => ({ key })));
      await audit(null, { action: "login_failed", entity: "auth", summary: `Failed Super Admin sign-in for ${email}` });
      return { ok: false, error: "Incorrect email or password." };
    }

    if (env.superAdmin.totpSecret) {
      const token = await signToken({ email, remember }, new Date(Date.now() + 5 * 60_000), "2fa");
      (await cookies()).set(PENDING_2FA_COOKIE, token, { httpOnly: true, secure: env.isProduction, sameSite: "lax", path: "/", maxAge: 300 });
      return { ok: true, data: { next: `/login/verify?next=${encodeURIComponent(safeNext(input.next))}` } };
    }

    await completeLogin(remember);
    return { ok: true, data: { next: safeNext(input.next) } };
  } catch (error) {
    console.error("[login] super admin sign-in failed", error);
    return { ok: false, error: error instanceof Error && error.message.includes("SUPER_ADMIN") ? error.message : "Sign-in failed. Please try again." };
  }
}

export async function verifySuperAdminCode(input: Record<string, unknown>): Promise<ActionResult<{ next: string }>> {
  try {
    await connectDB();
    const jar = await cookies();
    const pending = await verifyToken<{ email: string; remember: boolean }>(jar.get(PENDING_2FA_COOKIE)?.value, "2fa");
    if (!pending) return { ok: false, error: "Your verification window expired. Sign in again." };

    const { ip } = await requestMeta();
    const keys = [`2fa:${pending.email}`, `ip:${ip ?? "unknown"}`];
    if (await tooManyAttempts(keys)) return { ok: false, error: "Too many failed attempts. Try again in 15 minutes." };

    const code = String(input.code ?? "").replace(/\s+/g, "");
    // A code is single-use: replaying it inside its validity window is refused.
    const usedKey = `totp-used:${pending.email}:${code}`;
    const replay = await LoginAttempt.exists({ key: usedKey, at: { $gte: new Date(Date.now() - 3 * 60_000) } });
    if (replay || !verifyTotp(env.superAdmin.totpSecret, code)) {
      await LoginAttempt.insertMany(keys.map((key) => ({ key })));
      return { ok: false, error: "That code is not valid. Check your authenticator app.", fieldErrors: { code: "Invalid code" } };
    }
    await LoginAttempt.create({ key: usedKey });
    jar.delete(PENDING_2FA_COOKIE);
    await completeLogin(Boolean(pending.remember));
    return { ok: true, data: { next: safeNext(input.next) } };
  } catch (error) {
    console.error("[login] 2FA failed", error);
    return { ok: false, error: "Verification failed. Please try again." };
  }
}
