import { dateParam, monthParam, type SearchParams } from "@/lib/query";

/** A `yyyy-MM-dd` search param that is also a real calendar day (rejects 2026-02-31). */
export function dayParam(sp: SearchParams, key: string): string | undefined {
  const v = dateParam(sp, key);
  if (!v) return undefined;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : undefined;
}

/** A `yyyy-MM` search param with a valid month number. */
export function validMonthParam(sp: SearchParams, key: string): string | undefined {
  const v = monthParam(sp, key);
  return v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : undefined;
}
