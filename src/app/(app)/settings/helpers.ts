import "server-only";
import { ActionError } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import type { CurrentUser } from "@/lib/auth/session";
import type { AppSettings } from "@/lib/config-defaults";
import { connectDB } from "@/lib/db";
import { Lead, Project, Task, User } from "@/lib/models";
import { getSettings, saveSettingsSection } from "@/lib/settings";

type Change = { field: string; from?: string; to?: string };

function clip(value: string, max = 80): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

function isKeyedList(v: unknown): v is { key: string }[] {
  return Array.isArray(v) && v.length > 0 && v.every((i) => isRecord(i) && typeof i.key === "string");
}

function labelOf(item: Record<string, unknown>): string {
  return String(item.label ?? item.name ?? item.key ?? "");
}

function show(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (Array.isArray(value)) return value.map((v) => (isRecord(v) ? JSON.stringify(v) : String(v))).join(", ");
  if (isRecord(value)) return JSON.stringify(value);
  return String(value);
}

function collect(before: unknown, after: unknown, path: string, out: Change[]): void {
  if (isKeyedList(before) || isKeyedList(after)) {
    const b = new Map(((before as { key: string }[]) ?? []).map((i) => [i.key, i as unknown as Record<string, unknown>]));
    const a = new Map(((after as { key: string }[]) ?? []).map((i) => [i.key, i as unknown as Record<string, unknown>]));
    for (const [key, item] of b) if (!a.has(key)) out.push({ field: `${path}[${key}]`, from: clip(labelOf(item)), to: "Removed" });
    for (const [key, item] of a) if (!b.has(key)) out.push({ field: `${path}[${key}]`, from: "", to: `Added: ${clip(labelOf(item))}` });
    const common = [...a.keys()].filter((k) => b.has(k));
    for (const key of common) collect(b.get(key), a.get(key), `${path}[${key}]`, out);
    const orderBefore = [...b.keys()].filter((k) => a.has(k));
    if (orderBefore.join() !== common.join()) {
      out.push({ field: `${path} order`, from: clip(orderBefore.map((k) => labelOf(b.get(k)!)).join(" › ")), to: clip(common.map((k) => labelOf(a.get(k)!)).join(" › ")) });
    }
    return;
  }
  if (Array.isArray(before) || Array.isArray(after)) {
    const from = show(before);
    const to = show(after);
    if (from !== to) out.push({ field: path, from: clip(from, 300), to: clip(to, 300) });
    return;
  }
  if (isRecord(before) || isRecord(after)) {
    const keys = new Set([...Object.keys((before as Record<string, unknown>) ?? {}), ...Object.keys((after as Record<string, unknown>) ?? {})]);
    for (const key of keys) collect((before as Record<string, unknown> | undefined)?.[key], (after as Record<string, unknown> | undefined)?.[key], path ? `${path}.${key}` : key, out);
    return;
  }
  const from = show(before);
  const to = show(after);
  if (from !== to) out.push({ field: path, from: clip(from, 300), to: clip(to, 300) });
}

/** Field-level differences between two config values (arrays of `{ key }` items are matched by key). */
export function configChanges(before: unknown, after: unknown, root: string): Change[] {
  const out: Change[] = [];
  collect(before, after, root, out);
  return out.slice(0, 100);
}

function summarize(label: string, changes: Change[]): string {
  const parts = changes.slice(0, 3).map((c) => {
    const name = c.field.split(".").slice(1).join(".") || c.field;
    return c.from === "" ? `${name}: ${c.to}` : c.to === "Removed" ? `${name}: removed` : `${name}: ${clip(c.from ?? "", 30)} → ${clip(c.to ?? "", 30)}`;
  });
  const more = changes.length > 3 ? ` (+${changes.length - 3} more)` : "";
  return `Updated ${label} · ${parts.join("; ")}${more}`;
}

/** Saves one settings section and writes an audit entry describing what changed. */
export async function saveConfig<K extends keyof AppSettings>(
  user: CurrentUser,
  section: K,
  label: string,
  next: AppSettings[K],
): Promise<{ changed: number }> {
  const before = (await getSettings())[section];
  const changes = configChanges(before, next, String(section));
  if (changes.length === 0) return { changed: 0 };
  await saveSettingsSection(section, next, user.id);
  await audit(user, {
    action: "config",
    entity: "settings",
    entityId: String(section),
    ref: label,
    summary: summarize(label, changes),
    changes,
  });
  return { changed: changes.length };
}

/** URL-safe slug used for generated keys. */
export function slugify(label: string): string {
  const slug = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return slug || "item";
}

/**
 * Gives every row a stable key. Rows that carry a key already present in `existing` keep it
 * (keys never change once used); new rows get a unique slug of their label. Keys of removed
 * rows are never reused.
 */
export function assignKeys<T extends { key?: string }>(
  rows: T[],
  existing: { key: string }[],
  labelFor: (row: T) => string,
): (Omit<T, "key"> & { key: string })[] {
  const known = new Set(existing.map((e) => e.key));
  const taken = new Set(known);
  const used = new Set<string>();
  return rows.map((row) => {
    if (row.key && known.has(row.key) && !used.has(row.key)) {
      used.add(row.key);
      return { ...row, key: row.key };
    }
    const base = slugify(labelFor(row));
    let key = base;
    for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
    taken.add(key);
    used.add(key);
    return { ...row, key };
  });
}

/** Throws unless every label is unique (case-insensitive). */
export function assertUniqueLabels(labels: string[], what: string): void {
  const seen = new Set<string>();
  for (const label of labels) {
    const k = label.trim().toLowerCase();
    if (seen.has(k)) throw new ActionError(`Each ${what} must have a different name. "${label}" appears more than once.`);
    seen.add(k);
  }
}

export type StatusKind = "project" | "task" | "pipeline" | "employment";

/** How many records use each status key (used to block removal of statuses that are in use). */
export async function statusUsage(kind: StatusKind): Promise<Record<string, number>> {
  await connectDB();
  type Row = { _id: string; n: number };
  const group = (field: string) => [{ $group: { _id: `$${field}`, n: { $sum: 1 } } }];
  const rows: Row[] =
    kind === "project"
      ? await Project.aggregate<Row>(group("status"))
      : kind === "task"
        ? await Task.aggregate<Row>(group("status"))
        : kind === "pipeline"
          ? await Lead.aggregate<Row>(group("stage"))
          : await User.aggregate<Row>(group("status"));
  return Object.fromEntries(rows.filter((r) => r._id).map((r) => [r._id, r.n]));
}

export const USAGE_NOUN: Record<StatusKind, string> = {
  project: "project(s)",
  task: "task(s)",
  pipeline: "lead(s)",
  employment: "person(s)",
};

/** Throws when a status that is in use is missing from the submitted list. */
export async function assertStatusesRemovable(kind: StatusKind, existing: { key: string; label: string }[], next: { key: string }[]): Promise<void> {
  const nextKeys = new Set(next.map((n) => n.key));
  const removed = existing.filter((e) => !nextKeys.has(e.key));
  if (removed.length === 0) return;
  const usage = await statusUsage(kind);
  const blocked = removed.filter((r) => (usage[r.key] ?? 0) > 0);
  if (blocked.length > 0) {
    throw new ActionError(
      `Can't remove ${blocked.map((b) => `"${b.label}" (${usage[b.key]} ${USAGE_NOUN[kind]})`).join(", ")} because it is in use. Rename it instead, or move the records to another status first.`,
    );
  }
}
