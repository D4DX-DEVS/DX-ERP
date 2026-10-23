import "server-only";
import { cache } from "react";
import { connectDB } from "@/lib/db";
import { Settings } from "@/lib/models";
import { DEFAULT_SETTINGS, type AppSettings } from "@/lib/config-defaults";

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
  await connectDB();
  const doc = await Settings.findById("global").lean();
  return merge(structuredClone(DEFAULT_SETTINGS), doc?.value ?? {});
});

/** Replaces one top-level settings section. */
export async function saveSettingsSection<K extends keyof AppSettings>(
  section: K,
  value: AppSettings[K],
  userId?: string,
): Promise<void> {
  await connectDB();
  await Settings.updateOne(
    { _id: "global" },
    { $set: { [`value.${String(section)}`]: value, updatedBy: userId } },
    { upsert: true },
  );
}
