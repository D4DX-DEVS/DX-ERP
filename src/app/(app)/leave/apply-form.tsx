"use client";

import { useMemo, useState } from "react";
import { Alert } from "@/components/ui/page";
import { FileUpload } from "@/components/ui/file-upload";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Input, Radio, Select, Switch, Textarea } from "@/components/ui/input";
import { diffDays, eachDay, fmtDate, weekday } from "@/lib/time";
import { applyLeave } from "./actions";

export interface LeaveTypeOption {
  id: string;
  name: string;
  allowHalfDay: boolean;
  /** Not balance-limited (unpaid). */
  unlimited: boolean;
  available: number;
  requiresAttachmentAfterDays?: number;
}

export interface BusyRange {
  start: string;
  end: string;
  status: string;
}

interface Props {
  types: LeaveTypeOption[];
  workingDays: number[];
  /** Mandatory holiday dates (yyyy-MM-dd) around the selectable range. */
  holidays: string[];
  countWeekends: boolean;
  allowNegative: boolean;
  busy: BusyRange[];
  approvalNote: string;
}

const STATUS_TEXT: Record<string, string> = { pending_manager: "pending", pending_hr: "pending", approved: "approved" };

function Fields({ types, workingDays, holidays, countWeekends, allowNegative, busy, approvalNote, onDone }: Props & { onDone: () => void }) {
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [half, setHalf] = useState(false);
  const type = types.find((t) => t.id === typeId);

  const halfAllowed = Boolean(type?.allowHalfDay && start && start === end);
  const halfOn = halfAllowed && half;

  const counted = useMemo(() => {
    if (!start || !end || end < start || diffDays(start, end) > 400) return null;
    const days = eachDay(start, end);
    if (countWeekends) return days.length;
    const wd = new Set(workingDays);
    const hol = new Set(holidays);
    return days.filter((d) => wd.has(weekday(d)) && !hol.has(d)).length;
  }, [start, end, countWeekends, workingDays, holidays]);
  const days = counted === null ? null : halfOn ? (counted ? 0.5 : 0) : counted;

  const clash = start && end && end >= start ? busy.find((b) => b.start <= end && b.end >= start) : undefined;
  const short = type && !type.unlimited && !allowNegative && days !== null && days > type.available;
  const needsAttachment = Boolean(type && type.requiresAttachmentAfterDays != null && days !== null && days > type.requiresAttachmentAfterDays);

  return (
    <ActionForm action={applyLeave} successMessage="Leave request submitted" onSuccess={onDone}>
      <FormGrid cols={3}>
        <Field label="Leave type" name="leaveType" required>
          <Select id="leaveType" name="leaveType" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.unlimited ? "no limit" : `${t.available} left`}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From" name="startDate" required>
          <Input
            id="startDate"
            name="startDate"
            type="date"
            value={start}
            onChange={(e) => {
              const v = e.target.value;
              setStart(v);
              if (!end || end < v) setEnd(v);
            }}
          />
        </Field>
        <Field label="To" name="endDate" required>
          <Input id="endDate" name="endDate" type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </FormGrid>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {halfAllowed ? (
          <>
            <Switch name="halfDay" label="Half day" checked={half} onChange={(e) => setHalf(e.target.checked)} />
            {halfOn && (
              <div className="flex flex-wrap items-center gap-4" role="radiogroup" aria-label="Which half">
                <Radio name="halfDaySession" value="first" label="First half" defaultChecked />
                <Radio name="halfDaySession" value="second" label="Second half" />
              </div>
            )}
          </>
        ) : (
          <span className="text-[13px] text-muted">{type?.allowHalfDay ? "Choose the same start and end date to apply for a half day." : "Half-day isn't available for this leave type."}</span>
        )}
        <span className="ml-auto rounded-[10px] bg-brand-50 px-3 py-1.5 text-sm font-semibold text-brand-600" aria-live="polite">
          {days === null ? "Pick dates" : days === 0 ? "No working days" : `${days} ${days === 1 ? "day" : "days"}`}
        </span>
      </div>

      {days === 0 && <Alert tone="warning">The selected dates contain no working days. Weekends and holidays aren&apos;t counted.</Alert>}
      {clash && (
        <Alert tone="warning" title="Overlap:">
          you already have {STATUS_TEXT[clash.status] ?? ""} leave from {fmtDate(clash.start)}
          {clash.end !== clash.start ? ` to ${fmtDate(clash.end)}` : ""}. Submitting will be rejected.
        </Alert>
      )}
      {short && type && (
        <Alert tone="danger" title="Not enough balance:">
          you have {Math.max(0, type.available)} {type.name} day{type.available === 1 ? "" : "s"} available.
        </Alert>
      )}

      <Field label="Reason" name="reason" required>
        <Textarea id="reason" name="reason" rows={3} placeholder="Briefly explain the reason for your leave" />
      </Field>

      <Field label={needsAttachment ? "Supporting document" : "Attachment"} name="attachments" required={needsAttachment} hint={needsAttachment ? `Required for ${type?.name} longer than ${type?.requiresAttachmentAfterDays} days (e.g. a medical note).` : "Optional, e.g. a medical note for sick leave."}>
        <FileUpload name="attachments" context={{ entityType: "leave" }} label="Attach a document" />
      </Field>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-4">
        <span className="text-[13px] text-ink-2">{approvalNote}</span>
        <FormActions className="p-0">
          <SubmitButton size="lg">Submit request</SubmitButton>
        </FormActions>
      </div>
    </ActionForm>
  );
}

/** "Apply for leave" form with a live day count, overlap / balance hints and the attachment rule. */
export function ApplyLeaveForm(props: Props) {
  const [key, setKey] = useState(0);
  return <Fields key={key} {...props} onDone={() => setKey((k) => k + 1)} />;
}
