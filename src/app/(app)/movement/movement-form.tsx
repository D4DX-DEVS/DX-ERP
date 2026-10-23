"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Button, buttonClass } from "@/components/ui/button";
import { PeoplePicker, type PickerOption } from "@/components/ui/people-picker";
import { cn } from "@/lib/cn";
import { toLocalInput } from "@/lib/time";
import type { MovementCategory } from "@/lib/config-defaults";
import { addLateEntry, startMovement } from "./actions";

export interface RefOption {
  id: string;
  label: string;
}

export function MovementForm({
  mode,
  categories,
  projects,
  clients,
  people,
  personLabel,
  dateLabel,
  approverName,
  notCheckedIn,
  maxLateDays,
}: {
  mode: "live" | "late";
  categories: MovementCategory[];
  projects: RefOption[];
  clients: RefOption[];
  /** Present only for users who may record on behalf of others. */
  people?: PickerOption[];
  personLabel: string;
  dateLabel: string;
  approverName?: string;
  notCheckedIn: boolean;
  maxLateDays: number;
}) {
  const router = useRouter();
  const [category, setCategory] = useState(categories[0]?.key ?? "");
  const [expected, setExpected] = useState(() => toLocalInput(new Date(Date.now() + 60 * 60_000)));
  const selected = useMemo(() => categories.find((c) => c.key === category), [categories, category]);
  const approval = mode === "late" || selected?.requiresApproval;

  return (
    <ActionForm
      action={mode === "live" ? startMovement : addLateEntry}
      successMessage={mode === "live" ? "Out-Time recorded" : "Late entry submitted for approval"}
      onSuccess={(d) => router.push(`/movement/${d.id}`)}
      className="gap-5"
    >
      <div className="grid grid-cols-2 gap-3 rounded-xl bg-field p-4 text-[13px] sm:grid-cols-4">
        <span>
          <span className="text-muted">Person</span>
          <br />
          <strong className="font-semibold text-ink">{personLabel}</strong>
        </span>
        <span>
          <span className="text-muted">Date</span>
          <br />
          <strong className="font-semibold text-ink">{mode === "live" ? dateLabel : "As entered"}</strong>
        </span>
        <span>
          <span className="text-muted">Out-Time</span>
          <br />
          <strong className="font-semibold text-ink">{mode === "live" ? "Recorded when you confirm" : "Entered below"}</strong>
        </span>
        <span>
          <span className="text-muted">Movement ID</span>
          <br />
          <strong className="font-semibold text-ink">Assigned automatically</strong>
        </span>
      </div>

      {people && (
        <Field label="Record on behalf of" name="onBehalfOf" hint="Leave empty to record your own movement">
          <PeoplePicker name="onBehalfOf" options={people} placeholder="Myself" />
        </Field>
      )}

      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-2 text-[13px] font-semibold text-ink-2">Category</legend>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c) => {
            const on = c.key === category;
            return (
              <label key={c.key} className={cn("flex cursor-pointer items-start gap-2.5 rounded-xl px-3.5 py-3", on ? "border-2 border-brand-600 bg-brand-50" : "border border-line-strong bg-white hover:bg-field")}>
                <input type="radio" name="category" value={c.key} checked={on} onChange={() => setCategory(c.key)} className="mt-0.5 size-4 accent-brand-600" />
                <span className="flex flex-col">
                  <span className="text-sm font-semibold text-ink">{c.label}</span>
                  <span
                    className={cn(
                      "mt-1 inline-flex w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      c.requiresApproval || mode === "late" ? "bg-tone-purple-bg text-tone-purple" : "bg-tone-green-bg text-tone-green",
                    )}
                  >
                    {c.requiresApproval || mode === "late" ? "Manager approval" : "No approval"}
                    {!c.official && " · personal"}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <FormGrid>
        <Field label="Purpose" name="purpose" required>
          <Input id="purpose" name="purpose" maxLength={500} placeholder="e.g. Sprint demo with client product team" />
        </Field>
        <Field label="Destination" name="destination">
          <Input id="destination" name="destination" maxLength={300} placeholder={selected?.official === false ? "Optional for personal work" : "Where are you going?"} />
        </Field>
        <Field label="Project" name="project" hint="Optional reference">
          <Select id="project" name="project" defaultValue="">
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        {clients.length > 0 ? (
          <Field label="Client" name="client" hint="Optional reference">
            <Select id="client" name="client" defaultValue="">
              <option value="">No client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <div className="hidden sm:block" />
        )}
      </FormGrid>

      {mode === "late" ? (
        <FormGrid cols={3}>
          <Field label="Out-Time" name="outTime" required>
            <Input id="outTime" name="outTime" type="datetime-local" max={toLocalInput(new Date())} />
          </Field>
          <Field label="Expected return" name="expectedReturn">
            <Input id="expectedReturn" name="expectedReturn" type="datetime-local" />
          </Field>
          <Field label="In-Time" name="inTime" hint="Leave empty if still out">
            <Input id="inTime" name="inTime" type="datetime-local" max={toLocalInput(new Date())} />
          </Field>
        </FormGrid>
      ) : (
        <Field label="Expected return" name="expectedReturn" required>
          <div className="flex flex-wrap items-center gap-2">
            <Input id="expectedReturn" name="expectedReturn" type="datetime-local" value={expected} onChange={(e) => setExpected(e.target.value)} className="w-auto min-w-56 flex-1 sm:flex-none" />
            {[30, 60, 120, 180].map((mins) => (
              <Button key={mins} size="sm" variant="secondary" onClick={() => setExpected(toLocalInput(new Date(Date.now() + mins * 60_000)))}>
                +{mins < 60 ? `${mins}m` : `${mins / 60}h`}
              </Button>
            ))}
          </div>
        </Field>
      )}

      <Field label="Remarks" name="remarks" hint="Optional">
        <Textarea id="remarks" name="remarks" rows={2} maxLength={1000} />
      </Field>

      {mode === "late" && (
        <Field label="Why is this entered late?" name="reason" required hint={`Late entries are allowed for the last ${maxLateDays} days and always go for approval.`}>
          <Textarea id="reason" name="reason" rows={2} maxLength={500} placeholder="Required" />
        </Field>
      )}

      <div className="flex gap-2.5 rounded-[10px] bg-brand-50 px-3.5 py-3 text-[13px] text-ink-2">
        <Info className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
        <span>
          {approval
            ? `This movement goes to ${approverName ?? "an approver"} for approval.`
            : `${selected?.label ?? "This category"} doesn't need approval.`}{" "}
          You stay checked in; movements are logged separately from attendance.
          {notCheckedIn && mode === "live" && " Note: you haven't checked in today."}
        </span>
      </div>

      <FormActions>
        <Link href="/movement" className={buttonClass("ghost")}>
          Cancel
        </Link>
        <SubmitButton size="lg">{mode === "live" ? "Confirm & record Out-Time" : "Submit late entry"}</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}
