import "server-only";
import { cache } from "react";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { Settings } from "@/lib/models";
import { DEFAULT_SETTINGS, normalizeTaxes, type AppSettings } from "@/lib/config-defaults";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/** Deep-merges stored values over defaults. Arrays from storage replace defaults wholesale. */
function merge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override === undefined ? base : (override as T)) ?? base;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = (base as Record<string, unknown>)[key];
    out[key] = isPlainObject(current) && isPlainObject(value) ? merge(current, value) : value;
  }
  return out as T;
}

/** Effective configuration for this request (defaults + stored overrides). */
export const getSettings = cache(async (): Promise<AppSettings> => {
  const [row] = await db().select({ value: Settings.value }).from(Settings).where(eq(Settings._id, "global")).limit(1);
  const settings = merge(structuredClone(DEFAULT_SETTINGS), row?.value ?? {});
  return { ...settings, taxes: normalizeTaxes(settings.taxes) };
});

/** Replaces one top-level settings section. */
export async function saveSettingsSection<K extends keyof AppSettings>(
  section: K,
  value: AppSettings[K],
  userId?: string,
): Promise<void> {
  // Upsert that replaces only `value.<section>` (json_set), so concurrent saves of other sections are kept.
  await db()
    .insert(Settings)
    .values({ _id: "global", value: { [section]: value }, updatedBy: userId })
    .onConflictDoUpdate({
      target: Settings._id,
      set: {
        value: sql`json_set(${Settings.value}, ${`$.${String(section)}`}, json(${JSON.stringify(value)}))`,
        updatedBy: userId,
        updatedAt: new Date(),
      },
    });
}
