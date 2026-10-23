import { round2 } from "@/lib/format";

/** Client-safe proposal arithmetic, shared by the live form preview and the server (which always recomputes). */
export interface ItemInput {
  description: string;
  quantity: number;
  rate: number;
  taxRate: number;
}

export interface Totals {
  items: (ItemInput & { amount: number })[];
  subtotal: number;
  discount: number;
  taxTotal: number;
  total: number;
}

const num = (n: number) => (Number.isFinite(n) ? n : 0);

/**
 * Line amount = quantity × rate. The discount is spread proportionally over the lines, so tax is
 * charged on the discounted value: tax = Σ(amount × rate%) × (subtotal − discount) / subtotal.
 */
export function computeTotals(items: ItemInput[], discount: number): Totals {
  const lines = items.map((i) => ({ ...i, amount: round2(Math.max(0, num(i.quantity)) * Math.max(0, num(i.rate))) }));
  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const disc = round2(Math.min(Math.max(0, num(discount)), subtotal));
  const factor = subtotal > 0 ? (subtotal - disc) / subtotal : 1;
  const taxTotal = round2(lines.reduce((s, l) => s + (l.amount * Math.max(0, num(l.taxRate))) / 100, 0) * factor);
  return { items: lines, subtotal, discount: disc, taxTotal, total: round2(subtotal - disc + taxTotal) };
}

/** Amounts for a payment schedule; the last milestone absorbs rounding so the schedule always sums to the total. */
export function scheduleAmounts(total: number, percents: number[]): number[] {
  let allocated = 0;
  return percents.map((p, i) => {
    if (i === percents.length - 1) return round2(total - allocated);
    const amount = round2((total * num(p)) / 100);
    allocated += amount;
    return amount;
  });
}

export function percentSum(percents: number[]): number {
  return round2(percents.reduce((s, p) => s + num(p), 0));
}
