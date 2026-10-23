import "server-only";
import type { AppSettings } from "@/lib/config-defaults";
import { connectDB } from "@/lib/db";
import { accruedFor, leaveYearRange, type LeaveBalanceRow } from "@/lib/domain/leave-balance";
import { LeaveBalance, LeaveRequest, LeaveType, type ILeaveBalance, type ILeaveType } from "@/lib/models";

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
  await connectDB();
  const { from, to } = leaveYearRange(year, settings);
  const ids = users.map((u) => u.id);
  const [types, balances, requests] = await Promise.all([
    LeaveType.find({ active: true }).sort({ order: 1, name: 1 }).lean(),
    LeaveBalance.find({ user: { $in: ids }, year }).lean(),
    LeaveRequest.find(
      { user: { $in: ids }, status: { $in: ["approved", "pending_manager", "pending_hr"] }, startDate: { $lte: to }, endDate: { $gte: from } },
      { user: 1, leaveType: 1, days: 1, status: 1 },
    ).lean(),
  ]);

  const key = (user: string, type: string) => `${user}:${type}`;
  const stored = new Map(balances.map((b) => [key(b.user.toString(), b.leaveType.toString()), b]));
  const usage = new Map<string, { used: number; pending: number }>();
  for (const r of requests) {
    const k = key(r.user.toString(), r.leaveType.toString());
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
      const k = key(person.id, t._id.toString());
      const b = stored.get(k);
      const u = usage.get(k) ?? { used: 0, pending: 0 };
      const quota = b?.quotaOverride ?? t.annualQuota;
      const accrued = accruedFor(t, quota, year, asOf, settings);
      const carriedForward = b?.carriedForward ?? 0;
      const adjustment = b?.adjustment ?? 0;
      perType.set(t._id.toString(), {
        leaveTypeId: t._id.toString(),
        name: t.name,
        code: t.code,
        color: t.color,
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
