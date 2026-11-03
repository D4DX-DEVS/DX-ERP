"use client";

import { useMemo, useState } from "react";
import { Alert } from "@/components/ui/page";
import { FileUpload } from "@/components/ui/file-upload";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Input, Radio, Select, Switch, Textarea } from "@/components/ui/input";
import { diffDays, eachDay, fmtDate, isWorkingWeekday } from "@/lib/time";
import { applyLeave } from "./actions";

export interface LeaveTypeOption {
  id: string;
  name: string;
  kind: "standard" | "comp_off" | "optional_holiday";
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
  saturdaysOff: number[];
  /** Mandatory holiday dates (yyyy-MM-dd) around the selectable range. */
  holidays: string[];
  countWeekends: boolean;
  allowNegative: boolean;
  busy: BusyRange[];
  approvalNote: string;
  /** Upcoming optional holidays on working days: the only dates an optional-holiday type can be taken. */
  optionalHolidays: { date: string; name: string }[];
  /** Pre-selected from a link (e.g. "Take this optional holiday"). */
  initial?: { typeId: string; date: string };
}

const STATUS_TEXT: Record<string, string> = { pending_manager: "pending", pending_hr: "pending", approved: "approved" };

function Fields({ types, workingDays, saturdaysOff, holidays, countWeekends, allowNegative, busy, approvalNote, optionalHolidays, initial, onDone }: Props & { onDone: () => void }) {
  const [typeId, setTypeId] = useState(initial?.typeId ?? types[0]?.id ?? "");
  const [start, setStart] = useState(initial?.date ?? "");
  const [end, setEnd] = useState(initial?.date ?? "");
  const [half, setHalf] = useState(false);
  const type = types.find((t) => t.id === typeId);
  const optional = type?.kind === "optional_holiday";

  const halfAllowed = Boolean(type?.allowHalfDay && !optional && start && start === end);
  const halfOn = halfAllowed && half;

  const counted = useMemo(() => {
    if (!start || !end || end < start || diffDays(start, end) > 400) return null;
    const days = eachDay(start, end);
    if (countWeekends) return days.length;
    const hol = new Set(holidays);
    return days.filter((d) => isWorkingWeekday(d, { workingDays, saturdaysOff }) && !hol.has(d)).length;
  }, [start, end, countWeekends, workingDays, saturdaysOff, holidays]);
  const days = counted === null ? null : halfOn ? (counted ? 0.5 : 0) : counted;

  const clash = start && end && end >= start ? busy.find((b) => b.start <= end && b.end >= start) : undefined;
  const short = type && !type.unlimited && (!allowNegative || type.kind !== "standard") && days !== null && days > type.available;
  const notOptional = optional && start !== "" && !optionalHolidays.some((h) => h.date === start && start === end);
  const needsAttachment = Boolean(type && type.requiresAttachmentAfterDays != null && days !== null && days > type.requiresAttachmentAfterDays);

  return (
    <ActionForm action={applyLeave} successMessage="Leave request submitted" onSuccess={onDone}>
      <FormGrid cols={3}>
        <Field label="Leave type" name="leaveType" required>
          <Select
            id="leaveType"
            name="leaveType"
            value={typeId}
            onChange={(e) => {
              setTypeId(e.target.value);
              // Optional holidays are picked from the list; drop dates that aren't one.
              if (types.find((t) => t.id === e.target.value)?.kind === "optional_holiday" && !optionalHolidays.some((h) => h.date === start)) {
                setStart("");
                setEnd("");
              }
            }}
          >
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.unlimited ? "no limit" : `${t.available} left`}
              </option>
            ))}
          </Select>
        </Field>
        {optional ? (
          <Field label="Optional holiday" name="startDate" required className="sm:col-span-2">
            <Select
              id="startDate"
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                setEnd(e.target.value);
              }}
            >
              <option value="">{optionalHolidays.length ? "Choose an optional holiday" : "No upcoming optional holidays"}</option>
              {optionalHolidays.map((h) => (
                <option key={h.date} value={h.date}>
                  {fmtDate(h.date, "EEE d MMM yyyy")} · {h.name}
                </option>
              ))}
            </Select>
            <input type="hidden" name="startDate" value={start} />
            <input type="hidden" name="endDate" value={end} />
          </Field>
        ) : (
          <>
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
          </>
        )}
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
          <span className="text-[13px] text-muted">
            {optional ? "Optional holidays are taken as full days." : type?.allowHalfDay ? "Choose the same start and end date to apply for a half day." : "Half-day isn't available for this leave type."}
          </span>
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
          {type.kind === "comp_off" ? " Claim a comp-off for a weekend or holiday you worked first." : ""}
        </Alert>
      )}
      {notOptional && <Alert tone="warning">{type?.name} can only be taken on one of the optional holidays listed.</Alert>}

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
  // A new pre-selection (e.g. "Take it" on another optional holiday) starts a fresh form.
  return <Fields key={`${key}:${props.initial?.date ?? ""}`} {...props} onDone={() => setKey((k) => k + 1)} />;
}
