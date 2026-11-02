import "server-only";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { CompOffClaim, LeaveBalance, LeaveRequest, LeaveType, User, type ILeaveBalance, type ILeaveType, type LeaveKind } from "@/lib/models";
import type { AppSettings } from "@/lib/config-defaults";
import { inList } from "@/lib/sql";

export interface LeaveBalanceRow {
  leaveTypeId: string;
  name: string;
  code: string;
  color?: string;
  paid: boolean;
  kind: LeaveKind;
  /** Types with no quota (unpaid) are not balance-limited. */
  unlimited: boolean;
  /** The type's annual quota, before pro-rating. */
  annualQuota: number;
  /**
   * This person's entitlement for the leave year: the annual quota pro-rated for joining / leaving mid-year, or HR's
   * per-person override. Comp-off: the credits earned from approved claims.
   */
  quota: number;
  /** `quota` is below the annual quota because the person joined (or leaves) during the year. */
  prorated: boolean;
  /** Earned so far (monthly types release one month at a time). */
  accrued: number;
  carriedForward: number;
  adjustment: number;
  used: number;
  pending: number;
  available: number;
}

/** When a person is employed: joining date and (once set) last working day, as "yyyy-MM-dd". */
export interface ServicePeriod {
  joined?: string | null;
  left?: string | null;
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

/** Rounds down to whole or half days (leave is taken in half days, so a fraction is never granted early). */
export function floorHalf(days: number): number {
  return Math.floor(Math.round(days * 2 * 1e6) / 1e6) / 2;
}

/** 0-based month of the leave year a day falls in (negative before the year, 12+ after it). */
function monthOfYear(day: string, year: number, settings: AppSettings): number {
  const [y, m] = day.split("-").map(Number);
  return (y - year) * 12 + (m - settings.leave.yearStartMonth);
}

/**
 * Months of the leave year (0-based, inclusive) in which a person earns leave. Joining on or before the 15th earns the
 * joining month; leaving on or after the 15th earns the leaving month. `first > last` means none.
 */
export function earningMonths(year: number, settings: AppSettings, period: ServicePeriod): { first: number; last: number } {
  let first = 0;
  let last = 11;
  if (period.joined) first = Math.max(first, monthOfYear(period.joined, year, settings) + (Number(period.joined.slice(8, 10)) > 15 ? 1 : 0));
  if (period.left) last = Math.min(last, monthOfYear(period.left, year, settings) - (Number(period.left.slice(8, 10)) < 15 ? 1 : 0));
  return { first, last };
}

/**
 * A person's entitlement for one leave type and year, and how much of it is earned by `asOf`.
 * - Standard types are pro-rated to the months the person is employed in the year (12 CL/year, joined 10 Sep → 4).
 * - Monthly accrual releases one month at the start of each month (joined 10 Sep → 1 on 1 Sep… 3 by November);
 *   upfront types give the whole (pro-rated) entitlement from the joining date.
 * - Optional-holiday types keep their fixed count; an HR override replaces the computed entitlement.
 */
export function leaveEntitlement(
  type: Pick<ILeaveType, "annualQuota" | "accrual" | "kind">,
  override: number | null | undefined,
  year: number,
  asOf: string,
  settings: AppSettings,
  period: ServicePeriod,
): { quota: number; accrued: number; prorated: boolean } {
  const { first, last } = earningMonths(year, settings, period);
  const months = Math.max(0, last - first + 1);
  const fixed = type.kind !== "standard";
  const quota = override ?? (fixed ? type.annualQuota : floorHalf((type.annualQuota * months) / 12));
  const prorated = override == null && !fixed && quota < type.annualQuota;
  if (type.accrual === "monthly" && !fixed) {
    const elapsed = Math.max(0, Math.min(monthOfYear(asOf, year, settings), last) - first + 1);
    const accrued = override != null ? (months > 0 ? floorHalf((override * elapsed) / months) : 0) : floorHalf((type.annualQuota * elapsed) / 12);
    return { quota, accrued, prorated };
  }
  return { quota, accrued: !period.joined || asOf >= period.joined ? quota : 0, prorated };
}

/** The day balances are measured on for a leave year: today, kept inside that year (start of a future year, end of a past one). */
export function balanceDay(year: number, today: string, settings: AppSettings): string {
  const { from, to } = leaveYearRange(year, settings);
  return today < from ? from : today > to ? to : today;
}

export interface BulkBalances {
  types: ILeaveType[];
  /** user id → leave type id → computed balance (only types applicable to the person). */
  rows: Map<string, Map<string, LeaveBalanceRow>>;
  /** `${userId}:${typeId}` → stored LeaveBalance (adjustments, carry-forward, notes). */
  stored: Map<string, ILeaveBalance>;
}

/**
 * Balances for people for one leave year, measured on `asOf` (kept inside the year). "used" = approved requests,
 * "pending" = awaiting approval (so the same days can't be requested twice). Joining and leaving dates come from the
 * staff records; comp-off credits from approved claims. One set of queries however many people.
 */
export async function bulkLeaveBalances(users: { id: string; personType: string }[], year: number, settings: AppSettings, asOf: string): Promise<BulkBalances> {
  const { from, to } = leaveYearRange(year, settings);
  const day = balanceDay(year, asOf, settings);
  const ids = users.map((u) => u.id);
  const [types, balances, requests, people, credits] = await Promise.all([
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
    db().select({ id: User._id, joiningDate: User.joiningDate, internship: User.internship, exit: User.exit }).from(User).where(inList(User._id, ids)),
    db()
      .select({ user: CompOffClaim.user, leaveType: CompOffClaim.leaveType, days: CompOffClaim.days })
      .from(CompOffClaim)
      .where(and(inList(CompOffClaim.user, ids), eq(CompOffClaim.status, "approved"), eq(CompOffClaim.creditYear, year))),
  ]);

  const key = (user: string, type: string) => `${user}:${type}`;
  const stored = new Map(balances.map((b) => [key(b.user, b.leaveType), b]));
  const usage = new Map<string, { used: number; pending: number; earned: number }>();
  const tally = (k: string) => usage.get(k) ?? usage.set(k, { used: 0, pending: 0, earned: 0 }).get(k)!;
  for (const r of requests) {
    if (r.status === "approved") tally(key(r.user, r.leaveType)).used += r.days;
    else tally(key(r.user, r.leaveType)).pending += r.days;
  }
  for (const c of credits) tally(key(c.user, c.leaveType)).earned += c.days;
  const periods = new Map<string, ServicePeriod>(
    people.map((p) => [p.id, { joined: p.joiningDate || p.internship?.startDate || null, left: p.exit?.stage !== "none" ? p.exit?.lastWorkingDay || null : null }]),
  );

  const rows = new Map<string, Map<string, LeaveBalanceRow>>();
  for (const person of users) {
    const perType = new Map<string, LeaveBalanceRow>();
    const period = periods.get(person.id) ?? {};
    for (const t of types) {
      if (!t.applicableTo.includes(person.personType)) continue;
      const k = key(person.id, t._id);
      const b = stored.get(k);
      const u = usage.get(k) ?? { used: 0, pending: 0, earned: 0 };
      const { quota, accrued, prorated } = t.kind === "comp_off" ? { quota: u.earned, accrued: u.earned, prorated: false } : leaveEntitlement(t, b?.quotaOverride, year, day, settings, period);
      const carriedForward = b?.carriedForward ?? 0;
      const adjustment = b?.adjustment ?? 0;
      perType.set(t._id, {
        leaveTypeId: t._id,
        name: t.name,
        code: t.code,
        color: t.color ?? undefined,
        paid: t.paid,
        kind: t.kind,
        unlimited: !t.paid,
        annualQuota: t.annualQuota,
        quota,
        prorated,
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

/** One person's balances for a leave year (active types that apply to them, in display order). */
export async function leaveBalances(userId: string, personType: string, year: number, settings: AppSettings, asOf: string): Promise<LeaveBalanceRow[]> {
  const { types, rows } = await bulkLeaveBalances([{ id: userId, personType }], year, settings, asOf);
  const mine = rows.get(userId);
  return types.flatMap((t) => mine?.get(t._id) ?? []);
}
