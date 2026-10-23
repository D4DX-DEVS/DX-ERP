import { SearchX } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
        <SearchX className="size-7" />
      </span>
      <h1 className="font-display text-2xl font-semibold text-ink">Page not found</h1>
      <p className="max-w-md text-sm text-muted">The record may have been removed, or the link is incorrect.</p>
      <ButtonLink href="/dashboard" className="mt-2">
        Back to dashboard
      </ButtonLink>
    </div>
  );
}
