"use client";

import { useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { fmtDate } from "@/lib/time";
import { adjustLeaveBalance, setQuotaOverride } from "../actions";

export interface BalanceSummary {
  kind: string;
  quota: number;
  prorated: boolean;
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
  const compOff = summary.kind === "comp_off";
  const calculated = summary.quotaOverride == null ? summary.quota : undefined;
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={trigger} size="lg" title={`${leaveTypeName} · ${userName}`} description={`Leave year ${year}. Every change is recorded with your name and reason.`}>
      <div className="flex flex-col gap-5">
        <dl className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
          {(
            [
              [compOff ? "Earned" : "Entitled", summary.quota],
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
        {summary.prorated && (
          <p className="-mt-2 text-[13px] text-muted">
            Pro-rated: {summary.quota} of the {summary.defaultQuota}-day annual quota for the months {userName} is employed this year (a month counts when joined by the 15th).
          </p>
        )}
        {compOff && <p className="-mt-2 text-[13px] text-muted">Comp-off is earned through approved comp-off claims; use an adjustment only for corrections.</p>}

        <ActionForm action={adjustLeaveBalance} values={values} successMessage="Balance adjusted" resetOnSuccess>
          <h3 className="font-display text-[15px] font-semibold text-ink">Adjust balance</h3>
          <FormGrid cols={2}>
            <Field label="Days (+ or −)" name="amount" required hint="e.g. 2 to credit, −1 to deduct. Half days allowed.">
              <Input id="amount" name="amount" type="number" step="0.5" inputMode="decimal" placeholder="+2" />
            </Field>
            <Field label="Reason" name="reason" required>
              <Input id="reason" name="reason" placeholder="e.g. Correction after attendance review" />
            </Field>
          </FormGrid>
          <FormActions className="pt-0">
            <SubmitButton>Apply adjustment</SubmitButton>
          </FormActions>
        </ActionForm>

        {!compOff && (
          <ActionForm action={setQuotaOverride} values={values} successMessage="Quota saved">
            <h3 className="font-display text-[15px] font-semibold text-ink">Entitlement override</h3>
            <FormGrid cols={2}>
              <Field
                label={`Days for ${year}`}
                name="quota"
                hint={`${calculated !== undefined ? `Calculated: ${calculated} (annual ${summary.defaultQuota}${summary.prorated ? ", pro-rated" : ""}).` : `Annual quota is ${summary.defaultQuota}.`} Monthly types spread it over the months employed. Leave blank to use the calculation.`}
              >
                <Input id="quota" name="quota" type="number" step="0.5" min="0" inputMode="decimal" defaultValue={summary.quotaOverride ?? ""} placeholder={String(calculated ?? summary.defaultQuota)} />
              </Field>
              <Field label="Reason" name="reason" required>
                <Input id="quotaReason" name="reason" placeholder="e.g. Agreed in the offer letter" />
              </Field>
            </FormGrid>
            <FormActions className="pt-0">
              <SubmitButton variant="secondary">Save quota</SubmitButton>
            </FormActions>
          </ActionForm>
        )}

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
