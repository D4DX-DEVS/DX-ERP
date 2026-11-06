import { round2 } from "@/lib/format";
import { taxLabel, taxType, type TaxRate } from "@/lib/config-defaults";
import type { InvoiceStatus } from "@/lib/models/finance";

/**
 * Invoice arithmetic shared by the form (live totals), the server actions (authoritative totals) and the PDF.
 * Pure — no server-only imports.
 *
 *  - line amount = quantity × rate (before tax)
 *  - the invoice-level discount is spread over the lines in proportion to their amounts; tax is charged on the
 *    discounted line value, so the discount reduces the taxable value
 *  - each tax ticked on a line (e.g. CGST 9% and SGST 9%) is charged on that value separately
 *  - total = subtotal − discount + tax
 */
export interface ItemInput {
  description: string;
  quantity: number;
  rate: number;
  /** Taxes ticked on the line; none = no tax. */
  taxes?: TaxRate[];
  /** Lines saved before taxes were ticked separately carry one tax instead: its total rate, name and CGST + SGST split. */
  taxRate?: number;
  taxName?: string;
  taxSplit?: boolean;
}

export interface ComputedItem extends ItemInput {
  amount: number;
  /** Sum of the line's tax rates. */
  taxRate: number;
  tax: number;
  taxParts: (TaxRate & { amount: number })[];
}

export interface InvoiceTotals {
  items: ComputedItem[];
  subtotal: number;
  discount: number;
  taxTotal: number;
  total: number;
  /** Tax rows for the totals block, e.g. "CGST @ 9%" + "SGST @ 9%", or "IGST @ 18%". */
  taxLines: { label: string; amount: number }[];
}

/** The taxes on a line, also for lines saved with one combined tax ("CGST 9% + SGST 9%" → CGST 9%, SGST 9%). */
export function taxPartsOf(item: ItemInput): TaxRate[] {
  if (item.taxes) return item.taxes;
  const rate = Number(item.taxRate) || 0;
  if (!rate) return [];
  if (item.taxSplit) return [{ name: "CGST", rate: rate / 2 }, { name: "SGST", rate: rate / 2 }];
  return [{ name: item.taxName ? taxType(item.taxName) : "Tax", rate }];
}

function chargeTaxes(item: ItemInput, taxable: number): (TaxRate & { amount: number })[] {
  const parts = taxPartsOf(item);
  if (item.taxes || parts.length === 0) return parts.map((p) => ({ ...p, amount: round2((taxable * p.rate) / 100) }));
  // Lines saved with one combined tax keep their original rounding: one tax on the line, CGST + SGST half each.
  const tax = round2((taxable * (Number(item.taxRate) || 0)) / 100);
  if (parts.length === 1) return [{ ...parts[0], amount: tax }];
  const cgst = round2(tax / 2);
  return [
    { ...parts[0], amount: cgst },
    { ...parts[1], amount: round2(tax - cgst) },
  ];
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
    const taxParts = chargeTaxes(l, Math.max(0, round2(l.amount - share)));
    return {
      ...l,
      taxRate: round2(taxParts.reduce((s, p) => s + p.rate, 0)),
      tax: round2(taxParts.reduce((s, p) => s + p.amount, 0)),
      taxParts,
    };
  });

  const byLabel = new Map<string, number>();
  for (const c of computed) {
    for (const p of c.taxParts) {
      if (p.amount <= 0) continue;
      const label = `${p.name} @ ${p.rate}%`;
      byLabel.set(label, round2((byLabel.get(label) ?? 0) + p.amount));
    }
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

/** A line's taxes for item tables: "CGST 9% + SGST 9%", "IGST 18%", or null when untaxed. */
export function lineTaxLabel(item: ItemInput): string | null {
  const parts = taxPartsOf(item);
  return parts.length ? parts.map(taxLabel).join(" + ") : null;
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
