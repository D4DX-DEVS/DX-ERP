import "server-only";
import type { BatchItem } from "drizzle-orm/batch";
import { db } from "@/lib/db";

/** Statements per D1 batch — each batch is one atomic round trip. */
const CHUNK = 50;

/**
 * Runs write statements as atomic D1 batches (one round trip per 50 statements) instead of one query per
 * row, which keeps loops over days / people inside D1's per-request query budget.
 */
export async function runBatch(statements: BatchItem<"sqlite">[]): Promise<void> {
  for (let i = 0; i < statements.length; i += CHUNK) {
    const chunk = statements.slice(i, i + CHUNK);
    await db().batch(chunk as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }
}
