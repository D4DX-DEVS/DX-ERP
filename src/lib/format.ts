const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const inrFormatter2 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** ₹18,42,500 (Indian digit grouping). Pass `paise` to keep two decimals. */
export function inr(amount: number | null | undefined, paise = false): string {
  if (amount == null || Number.isNaN(amount)) return "—";
  return (paise ? inrFormatter2 : inrFormatter).format(amount);
}

/** ₹42.6 L, ₹1.2 Cr, ₹85,000 */
export function inrCompact(amount: number | null | undefined): string {
  if (amount == null || Number.isNaN(amount)) return "—";
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(abs >= 1e8 ? 0 : 1)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)} L`;
  return inr(amount);
}

export function num(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return numberFormatter.format(value);
}

export function pct(value: number, total: number): number {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function fileSize(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
