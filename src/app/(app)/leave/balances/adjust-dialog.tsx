"use client";

import { useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { fmtDate } from "@/lib/time";
import { adjustLeaveBalance, setQuotaOverride } from "../actions";

export interface BalanceSummary {
  quota: number;
  accrued: number;
  carriedForward: number;
  adjustment: number;
  used: number;
  pending: number;
  available: number;
  quotaOverride?: number;
  defaultQuota: number;
}

export interface BalanceNoteView {
  amount: number;
  reason: string;
  byName?: string;
  at: string;
}

/** Adjust one person's balance for one leave type and year, or override their quota (leave.manage). */
export function AdjustBalanceDialog({
  trigger,
  userId,
  userName,
  leaveTypeId,
  leaveTypeName,
  year,
  summary,
  notes,
}: {
  trigger: ReactNode;
  userId: string;
  userName: string;
  leaveTypeId: string;
  leaveTypeName: string;
  year: number;
  summary: BalanceSummary;
  notes: BalanceNoteView[];
}) {
  const [open, setOpen] = useState(false);
  const values = { userId, leaveType: leaveTypeId, year };
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={trigger} size="lg" title={`${leaveTypeName} · ${userName}`} description={`Leave year ${year}. Every change is recorded with your name and reason.`}>
      <div className="flex flex-col gap-5">
        <dl className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
          {(
            [
              ["Quota", summary.quota],
              ["Accrued", summary.accrued],
              ["Carried fwd", summary.carriedForward],
              ["Adjusted", summary.adjustment],
              ["Used + pending", summary.used + summary.pending],
              ["Available", summary.available],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-xl bg-field px-2 py-2">
              <dt className="text-[11px] text-muted">{label}</dt>
              <dd className="font-display text-lg font-semibold tabular">{value}</dd>
            </div>
          ))}
        </dl>

        <ActionForm action={adjustLeaveBalance} values={values} successMessage="Balance adjusted" resetOnSuccess>
          <h3 className="font-display text-[15px] font-semibold text-ink">Adjust balance</h3>
          <FormGrid cols={2}>
            <Field label="Days (+ or −)" name="amount" required hint="e.g. 2 to credit, −1 to deduct. Half days allowed.">
              <Input id="amount" name="amount" type="number" step="0.5" inputMode="decimal" placeholder="+2" />
            </Field>
            <Field label="Reason" name="reason" required>
              <Input id="reason" name="reason" placeholder="e.g. Comp-off for weekend release" />
            </Field>
          </FormGrid>
          <FormActions className="pt-0">
            <SubmitButton>Apply adjustment</SubmitButton>
          </FormActions>
        </ActionForm>

        <ActionForm action={setQuotaOverride} values={values} successMessage="Quota saved">
          <h3 className="font-display text-[15px] font-semibold text-ink">Quota override</h3>
          <FormGrid cols={2}>
            <Field label="Annual quota for this person" name="quota" hint={`Type default is ${summary.defaultQuota}. Leave blank to remove the override.`}>
              <Input id="quota" name="quota" type="number" step="0.5" min="0" inputMode="decimal" defaultValue={summary.quotaOverride ?? ""} placeholder={String(summary.defaultQuota)} />
            </Field>
            <Field label="Reason" name="reason" required>
              <Input id="quotaReason" name="reason" placeholder="e.g. Pro-rated for mid-year joiner" />
            </Field>
          </FormGrid>
          <FormActions className="pt-0">
            <SubmitButton variant="secondary">Save quota</SubmitButton>
          </FormActions>
        </ActionForm>

        {notes.length > 0 && (
          <div>
            <h3 className="mb-2 font-display text-[15px] font-semibold text-ink">Recent changes</h3>
            <ul className="flex flex-col">
              {notes.map((n, i) => (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-line-soft py-1.5 text-[13px] first:border-t-0">
                  <span className="min-w-0 flex-1 text-ink-2">
                    <strong className="tabular">{n.amount > 0 ? `+${n.amount}` : n.amount}</strong> · {n.reason}
                  </span>
                  <span className="text-xs text-muted">
                    {n.byName ?? "System"} · {fmtDate(n.at)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
}
