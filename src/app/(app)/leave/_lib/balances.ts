import "server-only";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { AppSettings } from "@/lib/config-defaults";
import { db } from "@/lib/db";
import { accruedFor, leaveYearRange, type LeaveBalanceRow } from "@/lib/domain/leave-balance";
import { LeaveBalance, LeaveRequest, LeaveType, type ILeaveBalance, type ILeaveType } from "@/lib/models";
import { inList } from "@/lib/sql";

export type BalanceNote = ILeaveBalance["notes"][number];

export interface BulkBalances {
  types: ILeaveType[];
  /** user id → leave type id → computed balance (only types applicable to the person). */
  rows: Map<string, Map<string, LeaveBalanceRow>>;
  /** `${userId}:${typeId}` → stored LeaveBalance (adjustments, carry-forward, notes). */
  stored: Map<string, ILeaveBalance>;
}

/**
 * Balances for many people at once (same rules as `leaveBalances`, computed from one set of queries so the
 * balances table and the approval cards stay fast). "used" = approved requests, "pending" = awaiting approval.
 */
export async function bulkLeaveBalances(users: { id: string; personType: string }[], year: number, settings: AppSettings, asOf: string): Promise<BulkBalances> {
  const { from, to } = leaveYearRange(year, settings);
  const ids = users.map((u) => u.id);
  const [types, balances, requests] = await Promise.all([
    db().select().from(LeaveType).where(eq(LeaveType.active, true)).orderBy(asc(LeaveType.order), asc(LeaveType.name)),
    db()
      .select()
      .from(LeaveBalance)
      .where(and(inList(LeaveBalance.user, ids), eq(LeaveBalance.year, year))),
    db()
      .select({ user: LeaveRequest.user, leaveType: LeaveRequest.leaveType, days: LeaveRequest.days, status: LeaveRequest.status })
      .from(LeaveRequest)
      .where(
        and(
          inList(LeaveRequest.user, ids),
          inList(LeaveRequest.status, ["approved", "pending_manager", "pending_hr"]),
          lte(LeaveRequest.startDate, to),
          gte(LeaveRequest.endDate, from),
        ),
      ),
  ]);

  const key = (user: string, type: string) => `${user}:${type}`;
  const stored = new Map(balances.map((b) => [key(b.user, b.leaveType), b]));
  const usage = new Map<string, { used: number; pending: number }>();
  for (const r of requests) {
    const k = key(r.user, r.leaveType);
    const u = usage.get(k) ?? { used: 0, pending: 0 };
    if (r.status === "approved") u.used += r.days;
    else u.pending += r.days;
    usage.set(k, u);
  }

  const rows = new Map<string, Map<string, LeaveBalanceRow>>();
  for (const person of users) {
    const perType = new Map<string, LeaveBalanceRow>();
    for (const t of types) {
      if (!t.applicableTo.includes(person.personType)) continue;
      const k = key(person.id, t._id);
      const b = stored.get(k);
      const u = usage.get(k) ?? { used: 0, pending: 0 };
      const quota = b?.quotaOverride ?? t.annualQuota;
      const accrued = accruedFor(t, quota, year, asOf, settings);
      const carriedForward = b?.carriedForward ?? 0;
      const adjustment = b?.adjustment ?? 0;
      perType.set(t._id, {
        leaveTypeId: t._id,
        name: t.name,
        code: t.code,
        color: t.color ?? undefined,
        paid: t.paid,
        unlimited: !t.paid,
        quota,
        accrued,
        carriedForward,
        adjustment,
        used: u.used,
        pending: u.pending,
        available: Math.round((accrued + carriedForward + adjustment - u.used - u.pending) * 2) / 2,
      });
    }
    rows.set(person.id, perType);
  }
  return { types, rows, stored };
}
