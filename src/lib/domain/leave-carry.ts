import "server-only";
import type { BatchItem } from "drizzle-orm/batch";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { LeaveBalance, LeaveType, newId, PERSON_TYPES, User } from "@/lib/models";
import { EXITED_STATUSES } from "@/lib/people";
import { getSettings } from "@/lib/settings";
import { inList, jsonPush, notInList } from "@/lib/sql";
import { runBatch } from "./batch";
import { bulkLeaveBalances, leaveYearRange } from "./leave-balance";

/**
 * Carries unused balance from leave year `year` into `year + 1`, capped per type (FRS §9.3). Everything else resets:
 * the new year starts from its own accrual. Safe to run again — only balances whose carried amount changed are written,
 * so late approvals for the old year are picked up by a re-run. Returns the number of balances updated.
 */
export async function carryForwardBalances(year: number, by: { _id: string; name: string } | null): Promise<{ updated: number; carryTypes: number }> {
  const settings = await getSettings();
  const asOf = leaveYearRange(year, settings).to;
  const carryTypes = await db()
    .select()
    .from(LeaveType)
    .where(and(eq(LeaveType.active, true), eq(LeaveType.carryForward, true)));
  if (carryTypes.length === 0) return { updated: 0, carryTypes: 0 };

  const people = await db()
    .select({ _id: User._id, personType: User.personType })
    .from(User)
    .where(and(inList(User.personType, PERSON_TYPES), notInList(User.status, EXITED_STATUSES)));
  const { rows } = await bulkLeaveBalances(
    people.map((p) => ({ id: p._id, personType: p.personType })),
    year,
    settings,
    asOf,
  );
  const existing = await db()
    .select({ user: LeaveBalance.user, leaveType: LeaveBalance.leaveType, carriedForward: LeaveBalance.carriedForward })
    .from(LeaveBalance)
    .where(
      and(
        eq(LeaveBalance.year, year + 1),
        inList(
          LeaveBalance.leaveType,
          carryTypes.map((t) => t._id),
        ),
      ),
    );
  const current = new Map(existing.map((b) => [`${b.user}:${b.leaveType}`, b.carriedForward]));

  const at = new Date();
  const ops: BatchItem<"sqlite">[] = [];
  for (const person of people) {
    for (const t of carryTypes) {
      const row = rows.get(person._id)?.get(t._id);
      if (!row) continue;
      const carry = Math.min(Math.max(0, row.available), t.maxCarryForward);
      const previous = current.get(`${person._id}:${t._id}`) ?? 0;
      if (carry === previous) continue;
      const note = { _id: newId(), amount: carry, reason: `Carried forward from ${year}`, by: by?._id, byName: by?.name ?? "System", at };
      ops.push(
        db()
          .insert(LeaveBalance)
          .values({ user: person._id, leaveType: t._id, year: year + 1, carriedForward: carry, notes: [note] })
          .onConflictDoUpdate({
            target: [LeaveBalance.user, LeaveBalance.leaveType, LeaveBalance.year],
            set: { carriedForward: carry, notes: jsonPush(LeaveBalance.notes, note) },
          }),
      );
    }
  }
  await runBatch(ops);
  return { updated: ops.length, carryTypes: carryTypes.length };
}
