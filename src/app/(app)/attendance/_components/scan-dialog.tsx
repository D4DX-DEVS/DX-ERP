"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogIn, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/page";
import { QrScanner } from "@/components/ui/qr-scanner";
import type { ActionResult } from "@/lib/action-result";
import { fetchNetworkToken } from "@/lib/network-token";
import { checkIn, checkOut } from "../actions";

/**
 * Check in / Check out by scanning the rotating QR on the office attendance screen. `networkOrigin` (set while
 * the same-network rule is on): where to fetch this phone's network token, sent along with the code.
 */
export function ScanDialog({ mode, networkOrigin }: { mode: "in" | "out"; networkOrigin?: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The scanner reports the same code several times a second: send each code once, and never retry one that failed.
  const inFlight = useRef(false);
  const failed = useRef<string | null>(null);
  const label = mode === "in" ? "Check in" : "Check out";

  const onOpenChange = (next: boolean) => {
    if (next) {
      failed.current = null;
      setError(null);
    }
    setOpen(next);
  };

  const onScan = async (code: string) => {
    if (inFlight.current || code === failed.current) return;
    inFlight.current = true;
    setBusy(true);
    let result: ActionResult<null>;
    try {
      const network = networkOrigin == null ? undefined : (await fetchNetworkToken(networkOrigin))?.token;
      result = mode === "in" ? await checkIn(code, network) : await checkOut(code, network);
    } catch {
      result = { ok: false, error: "Could not reach the server. Check your connection, then close and scan again." };
    }
    inFlight.current = false;
    setBusy(false);
    if (result.ok) {
      toast.success(result.message ?? label);
      setOpen(false);
      router.refresh();
    } else {
      failed.current = code;
      setError(result.error);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={`Scan to ${label.toLowerCase()}`}
      description="Point your camera at the QR code on the office attendance screen."
      trigger={
        <Button variant={mode === "in" ? "primary" : "secondary"} icon={mode === "in" ? <LogIn className="size-4" /> : <LogOut className="size-4" />}>
          {label}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 pb-1">
        <QrScanner onResult={onScan} paused={busy} />
        {busy ? (
          <p className="flex items-center justify-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> {mode === "in" ? "Checking in…" : "Checking out…"}
          </p>
        ) : error ? (
          <Alert tone="danger">{error}</Alert>
        ) : (
          <p className="text-center text-xs text-muted">The code changes every minute — scan the one on the screen now.</p>
        )}
      </div>
    </Dialog>
  );
}
