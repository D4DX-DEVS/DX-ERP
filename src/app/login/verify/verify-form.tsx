"use client";

import Link from "next/link";
import { ActionForm, Field, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { verifySuperAdminCode } from "../actions";

export function VerifyForm({ next }: { next: string }) {
  return (
    <ActionForm action={verifySuperAdminCode} values={{ next }} successMessage={false} refresh={false} onSuccess={(d) => window.location.assign(d.next)}>
      <Field label="Verification code" name="code">
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          placeholder="123 456"
          className="h-12 text-center font-display text-2xl tracking-[0.3em]"
          autoFocus
        />
      </Field>
      <SubmitButton size="lg" className="w-full">
        Verify and continue
      </SubmitButton>
      <Link href="/login" className="text-center text-[13px] font-semibold text-muted hover:text-brand-600">
        ← Back to sign in
      </Link>
    </ActionForm>
  );
}
