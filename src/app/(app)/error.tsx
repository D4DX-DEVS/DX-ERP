"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-warning-bg text-warning">
        <AlertTriangle className="size-7" />
      </span>
      <h1 className="font-display text-2xl font-semibold text-ink">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted">
        The page couldn&apos;t be loaded. Try again — if it keeps happening, share this reference with the administrator{error.digest ? `: ${error.digest}` : "."}
      </p>
      <Button onClick={reset} className="mt-2">
        Try again
      </Button>
    </div>
  );
}
