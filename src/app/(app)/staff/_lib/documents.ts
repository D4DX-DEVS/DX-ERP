/** Pure helpers for employee document categories and expiry (client- and server-safe). */
import type { DocumentCategory } from "@/lib/config-defaults";
import { diffDays } from "@/lib/time";

export type ExpiryState = "none" | "valid" | "expiring" | "expired";

export interface ExpiryInfo {
  state: ExpiryState;
  /** Days until expiry (negative once expired); null when there is no expiry date. */
  days: number | null;
}

export const EXPIRY_WARNING_DAYS = 30;

export function expiryInfo(expiry: string | null | undefined, today: string, warnDays = EXPIRY_WARNING_DAYS): ExpiryInfo {
  if (!expiry) return { state: "none", days: null };
  const days = diffDays(today, expiry);
  if (days < 0) return { state: "expired", days };
  if (days <= warnDays) return { state: "expiring", days };
  return { state: "valid", days };
}

export function categoriesFor(categories: DocumentCategory[], personType: string): DocumentCategory[] {
  return categories.filter((c) => c.appliesTo.includes(personType));
}

/** Required categories (for the person type) that have no current document on file. */
export function missingRequired(categories: DocumentCategory[], personType: string, present: ReadonlySet<string>): DocumentCategory[] {
  return categoriesFor(categories, personType).filter((c) => c.required && !present.has(c.key));
}

export function expiryText(info: ExpiryInfo): string {
  if (info.state === "expired") return info.days === -1 ? "Expired yesterday" : `Expired ${Math.abs(info.days ?? 0)} days ago`;
  if (info.state === "expiring") return info.days === 0 ? "Expires today" : info.days === 1 ? "Expires tomorrow" : `Expires in ${info.days} days`;
  return "";
}
