"use client";

import { useState } from "react";
import { Eye, EyeOff, Info, ShieldCheck } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "@/components/ui/form";
import { Checkbox, Input } from "@/components/ui/input";
import { superAdminSignIn } from "./actions";

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function LoginForms({ next, googleConfigured, supportEmail }: { next: string; googleConfigured: boolean; supportEmail: string }) {
  const [remember, setRemember] = useState(true);
  const [adminOpen, setAdminOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const googleHref = `/api/auth/google?remember=${remember ? 1 : 0}${next ? `&next=${encodeURIComponent(next)}` : ""}`;

  return (
    <div className="flex flex-col gap-5">
      <a
        href={googleConfigured ? googleHref : undefined}
        aria-disabled={!googleConfigured}
        className="flex h-12 items-center justify-center gap-3 rounded-xl border border-line-strong bg-white text-[15px] font-semibold text-ink shadow-sm transition-colors hover:bg-field aria-disabled:pointer-events-none aria-disabled:opacity-50"
      >
        <GoogleIcon />
        Continue with Google
      </a>
      <Checkbox label="Keep me signed in on this device" checked={remember} onChange={(e) => setRemember(e.target.checked)} />

      <div className="flex gap-2.5 rounded-[10px] bg-ground px-3.5 py-3 text-[13px] leading-relaxed text-ink-2">
        <Info className="mt-0.5 size-[18px] shrink-0 text-brand-600" aria-hidden />
        <span>
          Accounts are created by the administrator. Only the work email registered for you can sign in. New joiner without access? Contact{" "}
          <a href={`mailto:${supportEmail}`} className="font-semibold text-brand-600 hover:text-brand-800">
            {supportEmail}
          </a>
          .
        </span>
      </div>

      <div className="border-t border-line-soft pt-4">
        {!adminOpen ? (
          <button type="button" onClick={() => setAdminOpen(true)} className="inline-flex items-center gap-2 text-[13px] font-semibold text-muted hover:text-brand-600">
            <ShieldCheck className="size-4" /> Administrator sign in
          </button>
        ) : (
          <ActionForm
            action={superAdminSignIn}
            values={{ next, remember: remember ? "on" : "" }}
            successMessage={false}
            refresh={false}
            onSuccess={(data) => {
              window.location.assign(data.next);
            }}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <ShieldCheck className="size-4 text-brand-600" /> Super Admin
            </div>
            <Field label="Email" name="email">
              <Input id="email" name="email" type="email" autoComplete="username" required />
            </Field>
            <Field label="Password" name="password">
              <div className="relative">
                <Input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required className="pr-11" />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:bg-field"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>
            <SubmitButton size="lg" className="w-full">
              Sign in
            </SubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );
}
