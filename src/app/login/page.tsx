import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-redirect";
import { getSettings } from "@/lib/settings";
import { Alert } from "@/components/ui/page";
import { BrandPanel } from "./brand-panel";
import { LoginForms } from "./login-forms";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  not_registered: "This Google account isn't registered in D4DX ERP. Ask the administrator to add your work email.",
  access_disabled: "Your login access is disabled. Contact HR / Admin.",
  google_cancelled: "Google sign-in was cancelled.",
  google_failed: "Google sign-in failed. Please try again.",
  invalid_state: "Your sign-in session expired. Please try again.",
  email_unverified: "Your Google email address is not verified.",
  domain_not_allowed: "Please use your D4DX work Google account.",
  account_mismatch: "This email is linked to a different Google account. Contact the administrator.",
  google_not_configured: "Google sign-in is not configured on the server yet.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : undefined, "");
  const user = await getCurrentUser().catch(() => null);
  if (user) redirect(next || "/dashboard");

  const error = typeof sp.error === "string" ? ERRORS[sp.error] : undefined;
  let supportEmail = "hr@d4dx.co";
  try {
    supportEmail = (await getSettings()).company.email || supportEmail;
  } catch {
    // Database unavailable — the page still renders so the error is visible after sign-in attempts.
  }

  return (
    <div className="flex min-h-dvh flex-wrap bg-white">
      <BrandPanel />
      <section className="flex flex-[1_1_480px] items-center justify-center px-5 py-12 sm:px-6">
        <div className="flex w-full max-w-[400px] flex-col gap-6">
          <Image src="/brand/d4dx-logo.png" alt="D4DX" width={60} height={64} className="h-16 w-auto self-start" priority />
          <div>
            <h2 className="font-display text-[28px] font-bold text-ink">Sign in</h2>
            <p className="mt-1.5 text-sm text-muted">Use your D4DX Google work account.</p>
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
          <LoginForms next={next} googleConfigured={env.google.configured} supportEmail={supportEmail} />
        </div>
      </section>
    </div>
  );
}
