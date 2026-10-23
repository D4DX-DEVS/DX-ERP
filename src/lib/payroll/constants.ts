import type { PayrollKind } from "@/lib/models";
import { fmtDate } from "@/lib/time";

export const PAYROLL_PAYMENT_METHODS = ["Bank transfer", "UPI", "Cheque", "Cash", "Other"] as const;

export const KIND_LABEL: Record<PayrollKind, string> = { salary: "Salary", stipend: "Stipend" };

/** "2026-10" → "October 2026" */
export function periodLabel(period: string): string {
  return fmtDate(`${period}-01`, "MMMM yyyy");
}

/** "2026-10" → "Oct 2026" */
export function periodShort(period: string): string {
  return fmtDate(`${period}-01`, "MMM yyyy");
}
