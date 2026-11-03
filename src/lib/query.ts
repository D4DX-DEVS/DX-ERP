import { isObjectId } from "@/lib/validation";

/** Next.js page `searchParams` after awaiting. */
export type SearchParams = Record<string, string | string[] | undefined>;

export const PAGE_SIZE = 20;

/** First value of a search param as a trimmed string ("" when absent). */
export function param(sp: SearchParams, key: string): string {
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

export function idParam(sp: SearchParams, key: string): string | undefined {
  const v = param(sp, key);
  return isObjectId(v) ? v : undefined;
}

export function dateParam(sp: SearchParams, key: string): string | undefined {
  const v = param(sp, key);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}

export function monthParam(sp: SearchParams, key: string): string | undefined {
  const v = param(sp, key);
  return /^\d{4}-\d{2}$/.test(v) ? v : undefined;
}

export function pageParam(sp: SearchParams): number {
  const n = Number.parseInt(param(sp, "page"), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : 1;
}

/** Builds a URL with the given params merged into the current ones. */
export function withParams(path: string, sp: SearchParams, updates: Record<string, string | null | undefined>): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val) next.set(k, val);
  }
  for (const [k, v] of Object.entries(updates)) {
    if (v === null || v === undefined || v === "") next.delete(k);
    else next.set(k, v);
  }
  next.delete("page");
  const qs = next.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Sort choices for a listing, keyed by their `?sort=` value; the first one is the default. */
export type SortChoices<O> = Record<string, { label: string; order: O }>;

/**
 * Resolves `?sort=` against a listing's choices (unknown values fall back to the first choice).
 * Returns the chosen entry plus `options` for `<SortSelect>`.
 */
export function sortParam<T extends Record<string, { label: string }>>(sp: SearchParams, choices: T): T[keyof T] & { key: Extract<keyof T, string>; options: { value: string; label: string }[] } {
  const v = param(sp, "sort");
  const key = (Object.hasOwn(choices, v) ? v : Object.keys(choices)[0]) as Extract<keyof T, string>;
  return { ...choices[key], key, options: Object.entries(choices).map(([value, c]) => ({ value, label: c.label })) };
}
