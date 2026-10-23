import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { safeNextPath } from "@/lib/safe-redirect";
import { PENDING_2FA_COOKIE, verifyToken } from "@/lib/auth/token";
import { BrandPanel } from "../brand-panel";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = { title: "Verify sign-in" };

export default async function VerifyPage({ searchParams }: PageProps<"/login/verify">) {
  const sp = await searchParams;
  const pending = await verifyToken((await cookies()).get(PENDING_2FA_COOKIE)?.value, "2fa");
  if (!pending) redirect("/login");
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : undefined);
  return (
    <div className="flex min-h-dvh flex-wrap bg-white">
      <BrandPanel />
      <section className="flex flex-[1_1_480px] items-center justify-center px-5 py-12">
        <div className="flex w-full max-w-[400px] flex-col gap-6">
          <Image src="/brand/d4dx-logo.png" alt="D4DX" width={60} height={64} className="h-16 w-auto self-start" />
          <div>
            <h2 className="font-display text-[28px] font-bold text-ink">Two-step verification</h2>
            <p className="mt-1.5 text-sm text-muted">Enter the 6-digit code from your authenticator app.</p>
          </div>
          <VerifyForm next={next} />
        </div>
      </section>
    </div>
  );
}
