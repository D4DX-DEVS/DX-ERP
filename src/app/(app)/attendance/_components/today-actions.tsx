"use client";

import { Coffee, LogIn, LogOut, MoveUpRight } from "lucide-react";
import { ActionButton } from "@/components/ui/actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { checkIn, checkOut, endBreak, startBreak } from "../actions";

export type TodayState = "can_check_in" | "working" | "on_break" | "done" | "unavailable";

/** Action buttons of the Today card: Check in / Start break / End break / Check out / Record movement out. */
export function TodayActions({
  state,
  openMovementId,
  unavailableNote,
}: {
  state: TodayState;
  /** Id of the person's open movement (status "out"), if any. */
  openMovementId?: string;
  unavailableNote?: string;
}) {
  if (state === "unavailable") return unavailableNote ? <p className="text-[13px] text-muted">{unavailableNote}</p> : null;
  if (state === "done") return <p className="text-[13px] text-muted">You&apos;re checked out for today. Use a correction request if a time is wrong.</p>;

  if (state === "can_check_in") {
    return (
      <div className="flex flex-wrap gap-2.5">
        <ActionButton action={checkIn} icon={<LogIn className="size-4" />} successMessage={false}>
          Check in
        </ActionButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2.5">
        {openMovementId ? (
          <ButtonLink href={`/movement/${openMovementId}`} icon={<MoveUpRight className="size-4" />}>
            Record return
          </ButtonLink>
        ) : (
          <ButtonLink href="/movement/new" icon={<MoveUpRight className="size-4" />}>
            Record movement out
          </ButtonLink>
        )}
        {state === "on_break" ? (
          <ActionButton action={endBreak} variant="secondary" icon={<Coffee className="size-4" />} successMessage={false}>
            End break
          </ActionButton>
        ) : (
          <ActionButton action={startBreak} variant="secondary" icon={<Coffee className="size-4" />} successMessage={false}>
            Start break
          </ActionButton>
        )}
        {openMovementId ? (
          <Button variant="secondary" disabled title="Record your return from the movement first" icon={<LogOut className="size-4" />}>
            Check out
          </Button>
        ) : (
          <ActionButton action={checkOut} variant="secondary" icon={<LogOut className="size-4" />} confirm="Check out for today? Your working day ends now." successMessage={false}>
            Check out
          </ActionButton>
        )}
      </div>
      {openMovementId && <p className="text-xs text-muted">You&apos;re out on a movement. It doesn&apos;t end your day — record your return, then check out.</p>}
    </div>
  );
}
