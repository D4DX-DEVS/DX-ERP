import "server-only";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { LeaveBalance, LeaveRequest, LeaveType, type ILeaveType } from "@/lib/models";
import type { AppSettings } from "@/lib/config-defaults";
import { inList, jsonHas } from "@/lib/sql";
import { monthKey } from "@/lib/time";

export interface LeaveBalanceRow {
  leaveTypeId: string;
  name: string;
  code: string;
  color?: string;
  paid: boolean;
  /** Types with no quota (unpaid, comp-off credited by adjustment) are not balance-limited unless they have credit. */
  unlimited: boolean;
  quota: number;
  accrued: number;
  carriedForward: number;
  adjustment: number;
  used: number;
  pending: number;
  available: number;
}

/** Leave year (by configured start month) containing a day key. */
export function leaveYearOf(day: string, settings: AppSettings): number {
  const [y, m] = day.split("-").map(Number);
  return m >= settings.leave.yearStartMonth ? y : y - 1;
}

export function leaveYearRange(year: number, settings: AppSettings): { from: string; to: string } {
  const startMonth = settings.leave.yearStartMonth;
  const from = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const endYear = startMonth === 1 ? year : year + 1;
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  return { from, to: `${endYear}-${String(endMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}` };
}

/** Accrued entitlement for the leave year up to `asOf` (monthly accrual is pro-rata, rounded to 0.5). */
export function accruedFor(type: Pick<ILeaveType, "annualQuota" | "accrual">, quota: number, year: number, asOf: string, settings: AppSettings): number {
  if (type.accrual !== "monthly") return quota;
  const { from } = leaveYearRange(year, settings);
  const [fy, fm] = from.split("-").map(Number);
  const [ay, am] = monthKey(new Date(`${asOf}T12:00:00Z`)).split("-").map(Number);
  const monthsElapsed = Math.min(12, Math.max(0, (ay - fy) * 12 + (am - fm) + 1));
  return Math.round(((quota * monthsElapsed) / 12) * 2) / 2;
}

/**
 * Balances for one person for a leave year. "used" counts approved requests; "pending" counts
 * requests awaiting approval (so the same days cannot be requested twice).
 */
export async function leaveBalances(
  userId: string,
  personType: string,
  year: number,
  settings: AppSettings,
  asOf: string,
): Promise<LeaveBalanceRow[]> {
  const { from, to } = leaveYearRange(year, settings);
  const [types, balances, requests] = await Promise.all([
    db()
      .select()
      .from(LeaveType)
      .where(and(eq(LeaveType.active, true), jsonHas(LeaveType.applicableTo, personType)))
      .orderBy(asc(LeaveType.order), asc(LeaveType.name)),
    db()
      .select()
      .from(LeaveBalance)
      .where(and(eq(LeaveBalance.user, userId), eq(LeaveBalance.year, year))),
    db()
      .select({ leaveType: LeaveRequest.leaveType, days: LeaveRequest.days, status: LeaveRequest.status })
      .from(LeaveRequest)
      .where(
        and(
          eq(LeaveRequest.user, userId),
          inList(LeaveRequest.status, ["approved", "pending_manager", "pending_hr"]),
          lte(LeaveRequest.startDate, to),
          gte(LeaveRequest.endDate, from),
        ),
      ),
  ]);
  const byType = new Map(balances.map((b) => [b.leaveType, b]));
  return types.map((t) => {
    const b = byType.get(t._id);
    const quota = b?.quotaOverride ?? t.annualQuota;
    const accrued = accruedFor(t, quota, year, asOf, settings);
    const used = requests.filter((r) => r.leaveType === t._id && r.status === "approved").reduce((s, r) => s + r.days, 0);
    const pending = requests.filter((r) => r.leaveType === t._id && r.status !== "approved").reduce((s, r) => s + r.days, 0);
    const carriedForward = b?.carriedForward ?? 0;
    const adjustment = b?.adjustment ?? 0;
    const unlimited = !t.paid;
    return {
      leaveTypeId: t._id,
      name: t.name,
      code: t.code,
      color: t.color ?? undefined,
      paid: t.paid,
      unlimited,
      quota,
      accrued,
      carriedForward,
      adjustment,
      used,
      pending,
      available: Math.round((accrued + carriedForward + adjustment - used - pending) * 2) / 2,
    };
  });
}
