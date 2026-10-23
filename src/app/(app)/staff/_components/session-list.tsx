"use client";

import { Laptop } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { ActionButton } from "@/components/ui/actions";
import { Chip } from "@/components/ui/chip";

export interface SessionRow {
  id: string;
  device: string;
  ip?: string;
  method: string;
  signedIn: string;
  lastActive: string;
  current: boolean;
}

/** Active sessions with per-session revoke and a "sign out everywhere" button. Actions are bound server actions. */
export function SessionList({
  sessions,
  revoke,
  revokeAll,
  revokeAllLabel,
}: {
  sessions: SessionRow[];
  revoke: (sessionId: string) => Promise<ActionResult<null>>;
  revokeAll?: () => Promise<ActionResult<null>>;
  revokeAllLabel: string;
}) {
  const others = sessions.filter((s) => !s.current).length;
  return (
    <div className="flex flex-col gap-3">
      {sessions.length === 0 ? (
        <p className="text-[13px] text-muted">No active sessions.</p>
      ) : (
        <ul className="flex flex-col">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 border-t border-line-soft py-3 first:border-t-0 first:pt-0">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-50 text-brand-600">
                <Laptop className="size-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                  {s.device}
                  {s.current && <Chip tone="green" size="sm">This device</Chip>}
                </div>
                <div className="text-xs text-muted">
                  {s.method === "google" ? "Google" : "Password"} · {s.ip ?? "unknown IP"} · signed in {s.signedIn} · active {s.lastActive}
                </div>
              </div>
              {!s.current && (
                <ActionButton variant="secondary" size="sm" action={() => revoke(s.id)} confirm="This device will be signed out immediately." successMessage="Session revoked">
                  Revoke
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {revokeAll && others > 0 && (
        <div>
          <ActionButton variant="danger-outline" size="sm" action={revokeAll} confirm="All other devices will be signed out immediately." successMessage="Signed out">
            {revokeAllLabel}
          </ActionButton>
        </div>
      )}
    </div>
  );
}
