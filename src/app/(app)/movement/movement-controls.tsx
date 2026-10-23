"use client";

import { useState } from "react";
import { useNow } from "@/components/ui/use-now";
import { Check, Clock, LogIn, X } from "lucide-react";
import { ActionButton, ReasonAction } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, SubmitButton } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { formatDuration, toLocalInput } from "@/lib/time";
import {
  approveMovement,
  cancelMovement,
  decideCorrection,
  recordInTime,
  rejectMovement,
  requestCorrection,
  resolveMovement,
  updateExpectedReturn,
} from "./actions";

/** Live "1:12:40" counter since Out-Time with a bar towards the expected return. */
export function ElapsedTimer({ outTime, expectedReturn, className }: { outTime: string; expectedReturn?: string | null; className?: string }) {
  const now = useNow(1000);
  const start = new Date(outTime).getTime();
  const elapsed = now ? Math.max(0, now - start) : 0;
  const h = Math.floor(elapsed / 3_600_000);
  const m = Math.floor((elapsed % 3_600_000) / 60_000);
  const s = Math.floor((elapsed % 60_000) / 1000);
  const expected = expectedReturn ? new Date(expectedReturn).getTime() : null;
  const total = expected ? expected - start : null;
  const pctValue = total && total > 0 ? Math.min(100, (elapsed / total) * 100) : 0;
  const remaining = expected && now ? Math.round((expected - now) / 60_000) : null;
  const overdue = remaining !== null && remaining < 0;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="font-display text-[34px] leading-none font-semibold text-ink tabular" aria-live="off">
        {now ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : "—:—:—"}
      </div>
      {expected && (
        <>
          <div className="h-2 rounded-full bg-track">
            <div className={cn("h-full rounded-full transition-[width]", overdue ? "bg-danger" : "bg-outside")} style={{ width: `${overdue ? 100 : pctValue}%` }} />
          </div>
          <div className={cn("text-xs font-medium", overdue ? "text-danger" : "text-muted")}>
            {remaining === null ? "" : overdue ? `${formatDuration(-remaining)} past expected return` : `${formatDuration(remaining)} left`}
          </div>
        </>
      )}
    </div>
  );
}

export function RecordInButton({ id, size = "md", className }: { id: string; size?: "md" | "lg"; className?: string }) {
  return (
    <ActionButton action={() => recordInTime(id)} size={size} icon={<LogIn className="size-4" />} className={className}>
      I&apos;m back · record In-Time
    </ActionButton>
  );
}

export function ExtendReturnDialog({ id, current }: { id: string; current?: string | null }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const base = () => Math.max(Date.now(), current ? new Date(current).getTime() : 0);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setValue(toLocalInput(new Date(base() + 30 * 60_000)));
      }}
      title="Update expected return"
      description="Your manager is told about the new time."
      trigger={
        <Button variant="secondary" icon={<Clock className="size-4" />}>
          Running late? Update return time
        </Button>
      }
    >
      <ActionForm action={(input) => updateExpectedReturn(id, input)} successMessage="Return time updated" onSuccess={() => setOpen(false)}>
        <Field label="New expected return" name="expectedReturn" required>
          <Input id="expectedReturn" name="expectedReturn" type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {[15, 30, 60, 120].map((mins) => (
            <Button key={mins} size="sm" variant="secondary" onClick={() => setValue(toLocalInput(new Date(base() + mins * 60_000)))}>
              +{mins < 60 ? `${mins}m` : `${mins / 60}h`}
            </Button>
          ))}
        </div>
        <Field label="Note" name="note" hint="Optional — e.g. meeting ran over">
          <Input id="note" name="note" maxLength={300} />
        </Field>
        <FormActions>
          <SubmitButton>Update</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}

export function CancelMovementButton({ id }: { id: string }) {
  return (
    <ReasonAction
      action={(reason) => cancelMovement(id, reason)}
      title="Cancel this movement?"
      description="Use this when the movement was recorded by mistake. The record is kept as cancelled."
      confirmLabel="Cancel movement"
      confirmVariant="danger"
      successMessage="Movement cancelled"
      trigger={<Button variant="ghost">Cancel movement</Button>}
    />
  );
}

export function ApprovalButtons({ id, compact = false }: { id: string; compact?: boolean }) {
  return (
    <div className="flex gap-2">
      <ReasonAction
        action={(reason) => rejectMovement(id, reason)}
        title="Reject movement"
        confirmLabel="Reject"
        confirmVariant="danger"
        successMessage="Movement rejected"
        trigger={
          compact ? (
            <Button variant="danger-outline" size="icon-sm" aria-label="Reject">
              <X className="size-4" />
            </Button>
          ) : (
            <Button variant="danger-outline">Reject</Button>
          )
        }
      />
      {compact ? (
        <ActionButton action={() => approveMovement(id)} variant="success" size="icon-sm" aria-label="Approve" successMessage="Approved">
          <Check className="size-4" />
        </ActionButton>
      ) : (
        <ActionButton action={() => approveMovement(id)} variant="success" successMessage="Movement approved">
          Approve
        </ActionButton>
      )}
    </div>
  );
}

export function CorrectionDecision({ id, correctionId }: { id: string; correctionId: string }) {
  return (
    <div className="flex gap-2">
      <ReasonAction
        action={(reason) => decideCorrection(id, correctionId, false, reason)}
        title="Reject correction"
        confirmLabel="Reject"
        confirmVariant="danger"
        trigger={<Button variant="danger-outline" size="sm">Reject</Button>}
      />
      <ReasonAction
        action={(note) => decideCorrection(id, correctionId, true, note)}
        title="Approve correction"
        description="The proposed times replace the recorded ones. The original times stay in the correction history."
        label="Note"
        required={false}
        confirmLabel="Approve"
        confirmVariant="success"
        trigger={<Button variant="success" size="sm">Approve</Button>}
      />
    </div>
  );
}

export function CorrectionDialog({ id, outTime, inTime, needsIn }: { id: string; outTime?: string | null; inTime?: string | null; needsIn: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Request a correction"
      description="Your manager reviews the change. The original times are kept in the audit trail."
      trigger={<Button variant="secondary">Request correction</Button>}
    >
      <ActionForm action={(input) => requestCorrection(id, input)} successMessage="Correction submitted" onSuccess={() => setOpen(false)}>
        <Field label="Correct Out-Time" name="outTime" required>
          <Input id="outTime" name="outTime" type="datetime-local" defaultValue={toLocalInput(outTime)} />
        </Field>
        <Field label="Correct In-Time" name="inTime" required={needsIn} hint={needsIn ? undefined : "Leave empty if you are still out"}>
          <Input id="inTime" name="inTime" type="datetime-local" defaultValue={toLocalInput(inTime)} />
        </Field>
        <Field label="Reason" name="reason" required>
          <Textarea id="reason" name="reason" rows={3} placeholder="Required — e.g. forgot to record when I came back" />
        </Field>
        <FormActions>
          <SubmitButton>Submit correction</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}

export function ResolveDialog({ id, outTime }: { id: string; outTime: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Resolve open movement"
      description="Record the return time on the person's behalf. This is logged with your name and note."
      trigger={<Button variant="secondary">Resolve</Button>}
    >
      <ActionForm action={(input) => resolveMovement(id, input)} successMessage="Movement resolved" onSuccess={() => setOpen(false)}>
        <Field label="In-Time" name="inTime" required hint={`Out-Time was ${new Date(outTime).toLocaleString("en-IN", { timeZone: process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Kolkata" })}`}>
          <Input id="inTime" name="inTime" type="datetime-local" defaultValue={toLocalInput(new Date())} />
        </Field>
        <Field label="Note" name="note" required>
          <Textarea id="note" name="note" rows={3} placeholder="How was the return time confirmed?" />
        </Field>
        <FormActions>
          <SubmitButton>Resolve</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}

/** Compact running duration ("1h 42m") that ticks every 30 seconds. */
export function LiveElapsed({ since, className }: { since: string; className?: string }) {
  const now = useNow(30_000);
  const mins = now ? Math.max(0, Math.round((now - new Date(since).getTime()) / 60_000)) : null;
  return <span className={cn("tabular", className)}>{mins === null ? "…" : formatDuration(mins)}</span>;
}
