import "server-only";
import type { BatchItem } from "drizzle-orm/batch";
import { db } from "@/lib/db";
import type { Id } from "@/lib/models";
import { notifyMany, type NotifyInput } from "@/lib/notify";

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

/** Delivers many reminders in a fixed number of queries (see `notifyMany`). Returns the number of (person, reminder) deliveries. */
export async function notifyBatch(items: BatchedNotification[]): Promise<number> {
  return notifyMany(items);
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
