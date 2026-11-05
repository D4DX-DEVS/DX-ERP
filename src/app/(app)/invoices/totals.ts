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
  /** Name of the tax chosen from Settings → Taxes (absent on lines saved before tax names were kept). */
  taxName?: string;
  /** Intra-state GST: charged as CGST + SGST, half the rate each. */
  taxSplit?: boolean;
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
  /** Tax rows for the totals block, e.g. "CGST @ 9%" + "SGST @ 9%", or "IGST 18%". */
  taxLines: { label: string; amount: number }[];
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

  const byLabel = new Map<string, number>();
  const add = (label: string, amount: number) => byLabel.set(label, round2((byLabel.get(label) ?? 0) + amount));
  for (const c of computed) {
    if (c.tax <= 0) continue;
    if (c.taxSplit) {
      const cgst = round2(c.tax / 2);
      add(`CGST @ ${c.taxRate / 2}%`, cgst);
      add(`SGST @ ${c.taxRate / 2}%`, round2(c.tax - cgst));
    } else add(c.taxName ?? `Tax @ ${c.taxRate}%`, c.tax);
  }
  const taxTotal = round2(computed.reduce((s, c) => s + c.tax, 0));
  return {
    items: computed,
    subtotal,
    discount,
    taxTotal,
    total: round2(subtotal - discount + taxTotal),
    taxLines: [...byLabel.entries()].map(([label, amount]) => ({ label, amount })),
  };
}

/** A line's tax for item tables: "9% + 9%" (CGST + SGST), "18%", or null when untaxed. */
export function lineTaxLabel(item: { taxRate: number; taxSplit?: boolean }): string | null {
  if (!item.taxRate) return null;
  return item.taxSplit ? `${item.taxRate / 2}% + ${item.taxRate / 2}%` : `${item.taxRate}%`;
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
