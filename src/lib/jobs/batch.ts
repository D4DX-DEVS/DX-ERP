import "server-only";
import { and } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { db } from "@/lib/db";
import { Notification, type Id } from "@/lib/models";
import { notify, type NotifyInput } from "@/lib/notify";
import { inList } from "@/lib/sql";

/**
 * Helpers that keep the scheduled jobs to a handful of queries however many rows they touch
 * (D1 caps the queries per request, so a job must not query once per row).
 */

export interface BatchedNotification {
  recipients: (Id | null | undefined)[];
  /** Same recipients-to-skip rule as `notify(recipients, input, exclude)`. */
  exclude?: (Id | null | undefined)[];
  /** Reminders always carry a dedupe key: the same key is delivered to a person only once. */
  input: NotifyInput & { dedupeKey: string };
}

/**
 * Delivers many reminders with ONE lookup for the whole batch of which (person, dedupeKey) pairs were
 * already delivered, then calls `notify` only for the people still to be told. `notify` itself still
 * de-duplicates the stored record, so a reminder is never delivered twice. Returns the number of
 * (person, reminder) deliveries attempted.
 */
export async function notifyBatch(items: BatchedNotification[]): Promise<number> {
  const planned = items
    .map(({ recipients, exclude, input }) => {
      const skip = new Set((exclude ?? []).filter(Boolean));
      const ids = [...new Set(recipients.filter((r): r is Id => Boolean(r)))].filter((id) => !skip.has(id));
      return { ids, input };
    })
    .filter((p) => p.ids.length > 0);
  if (planned.length === 0) return 0;

  const existing = await db()
    .select({ user: Notification.user, dedupeKey: Notification.dedupeKey })
    .from(Notification)
    .where(
      and(
        inList(Notification.dedupeKey, [...new Set(planned.map((p) => p.input.dedupeKey))]),
        inList(Notification.user, [...new Set(planned.flatMap((p) => p.ids))]),
      ),
    );
  const seen = new Set(existing.map((e) => `${e.user}|${e.dedupeKey}`));

  let sent = 0;
  for (const { ids, input } of planned) {
    const fresh = ids.filter((id) => !seen.has(`${id}|${input.dedupeKey}`));
    if (fresh.length === 0) continue;
    await notify(fresh, input);
    for (const id of fresh) seen.add(`${id}|${input.dedupeKey}`);
    sent += fresh.length;
  }
  return sent;
}

const WRITE_CHUNK = 50;

/**
 * Runs guarded single-row updates (each built with `.returning({ id })`) in a few D1 round trips instead of
 * one per row, and returns the ids whose guard matched (the equivalent of checking `modifiedCount`).
 */
export async function runGuardedUpdates(updates: BatchItem<"sqlite">[]): Promise<Set<string>> {
  const done = new Set<string>();
  for (let i = 0; i < updates.length; i += WRITE_CHUNK) {
    const chunk = updates.slice(i, i + WRITE_CHUNK) as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];
    const results = (await db().batch(chunk)) as { id: string }[][];
    for (const rows of results) for (const row of rows) done.add(row.id);
  }
  return done;
}
