import { round2 } from "@/lib/format";
import type { InvoiceStatus } from "@/lib/models/finance";

/**
 * Invoice arithmetic shared by the form (live totals) and the server actions (authoritative totals).
 * Pure — no server-only imports.
 *
 *  - line amount = quantity × rate (before tax)
 *  - the invoice-level discount is spread over the lines in proportion to their amounts; tax is charged on the
 *    discounted line value, so the discount reduces the taxable value
 *  - total = subtotal − discount + tax
 */
export interface ItemInput {
  description: string;
  quantity: number;
  rate: number;
  taxRate: number;
}

export interface ComputedItem extends ItemInput {
  amount: number;
  tax: number;
}

export interface InvoiceTotals {
  items: ComputedItem[];
  subtotal: number;
  discount: number;
  taxTotal: number;
  total: number;
  taxByRate: { rate: number; amount: number }[];
}

export function computeTotals(items: ItemInput[], discountInput: number): InvoiceTotals {
  const lines = items.map((i) => ({ ...i, amount: round2((Number(i.quantity) || 0) * (Number(i.rate) || 0)) }));
  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const discount = Math.min(Math.max(0, round2(Number(discountInput) || 0)), subtotal);

  let allocated = 0;
  const computed: ComputedItem[] = lines.map((l, index) => {
    const isLast = index === lines.length - 1;
    const share = subtotal > 0 ? (isLast ? round2(discount - allocated) : round2((discount * l.amount) / subtotal)) : 0;
    allocated = round2(allocated + share);
    const taxable = Math.max(0, round2(l.amount - share));
    const rate = Number(l.taxRate) || 0;
    return { ...l, taxRate: rate, tax: round2((taxable * rate) / 100) };
  });

  const byRate = new Map<number, number>();
  for (const c of computed) if (c.tax > 0) byRate.set(c.taxRate, round2((byRate.get(c.taxRate) ?? 0) + c.tax));
  const taxTotal = round2(computed.reduce((s, c) => s + c.tax, 0));
  return {
    items: computed,
    subtotal,
    discount,
    taxTotal,
    total: round2(subtotal - discount + taxTotal),
    taxByRate: [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, amount]) => ({ rate, amount })),
  };
}

export interface BalanceInput {
  total: number;
  amountPaid: number;
  amountRefunded: number;
  adjustments: number;
}

/** Balance = total − amountPaid + amountRefunded − adjustments (never below zero). */
export function balanceOf(i: BalanceInput): number {
  return Math.max(0, round2(i.total - i.amountPaid + i.amountRefunded - i.adjustments));
}

/** Persisted status of an issued invoice after any money movement (overdue is applied by the job / at display time). */
export function settledStatus(i: BalanceInput): Extract<InvoiceStatus, "issued" | "partially_paid" | "paid"> {
  if (balanceOf(i) <= 0) return "paid";
  return round2(i.amountPaid - i.amountRefunded) > 0 ? "partially_paid" : "issued";
}

/** Status shown to users: an unpaid invoice past its due date is overdue even before the job persists it. */
export function effectiveStatus(inv: { status: InvoiceStatus; dueDate: string; balance: number }, today: string): InvoiceStatus {
  if ((inv.status === "issued" || inv.status === "partially_paid") && inv.balance > 0 && inv.dueDate < today) return "overdue";
  return inv.status;
}

export const INVOICE_PAYMENT_METHODS = ["Bank transfer", "UPI", "Cheque", "Cash", "Card", "Other"] as const;

export const CUSTOM_TERM = "custom";
