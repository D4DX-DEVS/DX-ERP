import { ShieldX } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";

export default function Forbidden() {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-danger-bg text-danger">
        <ShieldX className="size-7" />
      </span>
      <h1 className="font-display text-2xl font-semibold text-ink">You don&apos;t have access to this page</h1>
      <p className="max-w-md text-sm text-muted">Your role doesn&apos;t include permission for this area. If you need access, ask the Super Admin or HR / Admin.</p>
      <ButtonLink href="/dashboard" className="mt-2">
        Back to dashboard
      </ButtonLink>
    </div>
  );
}
