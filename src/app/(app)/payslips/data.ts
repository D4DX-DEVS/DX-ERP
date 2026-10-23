import "server-only";
import { and, desc, eq, gte, isNull, lte, ne, or, sql } from "drizzle-orm";
import { can, type CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PayrollRun, Payslip, type IPayslip } from "@/lib/models";
import { inList } from "@/lib/sql";
import { isObjectId } from "@/lib/validation";
import { round2 } from "@/lib/format";

/**
 * Who may open a payslip: its owner once it is approved or paid, and anyone with `payroll.view`.
 * "hidden" is used for a draft that belongs to the viewer (they get a 404, not a hint that it exists).
 */
export function payslipAccess(viewer: CurrentUser, slip: Pick<IPayslip, "user" | "status">): "ok" | "forbidden" | "hidden" {
  if (can(viewer, "payroll.view")) return "ok";
  if (slip.user !== viewer.id) return "forbidden";
  return slip.status === "approved" || slip.status === "paid" ? "ok" : "hidden";
}

export interface PayslipListItem {
  id: string;
  period: string;
  kind: IPayslip["kind"];
  net: number;
  status: IPayslip["status"];
}

export interface PayslipPageData {
  slip: IPayslip;
  list: PayslipListItem[];
  owner: boolean;
  fy: { label: string; gross: number; deductions: number; net: number; count: number };
}

export type PayslipPageResult = { state: "ok"; data: PayslipPageData } | { state: "empty" } | { state: "notfound" } | { state: "forbidden" };

/** Financial-year label and period bounds ("yyyy-MM") for a payslip period. */
export function fiscalOfPeriod(period: string): { label: string; from: string; to: string } {
  const [y, m] = period.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return { label: `${start}-${String((start + 1) % 100).padStart(2, "0")}`, from: `${start}-04`, to: `${start + 1}-03` };
}

/**
 * Loads a payslip with the month list of the same person. Without an id it shows the signed-in person's latest
 * approved or paid payslip.
 */
export async function loadPayslipPage(viewer: CurrentUser, id?: string): Promise<PayslipPageResult> {
  let slip: IPayslip | null = null;
  if (id) {
    if (!isObjectId(id)) return { state: "notfound" };
    const [found] = await db().select().from(Payslip).where(eq(Payslip._id, id)).limit(1);
    if (!found) return { state: "notfound" };
    slip = found;
    const access = payslipAccess(viewer, slip);
    if (access === "forbidden") return { state: "forbidden" };
    if (access === "hidden") return { state: "notfound" };
  }

  const ownerId = slip ? slip.user : viewer._id;
  const seeAll = can(viewer, "payroll.view");
  const showDrafts = seeAll && Boolean(slip);
  // Payslips of a cancelled run never show (a payslip whose run is missing still does).
  const live = await db()
    .select({ _id: Payslip._id, period: Payslip.period, kind: Payslip.kind, net: Payslip.net, status: Payslip.status })
    .from(Payslip)
    .leftJoin(PayrollRun, eq(PayrollRun._id, Payslip.run))
    .where(
      and(
        eq(Payslip.user, ownerId),
        showDrafts ? undefined : inList(Payslip.status, ["approved", "paid"]),
        or(isNull(PayrollRun._id), ne(PayrollRun.status, "cancelled")),
      ),
    )
    .orderBy(desc(Payslip.period), desc(Payslip.createdAt));
  const list: PayslipListItem[] = live.map((r) => ({ id: r._id, period: r.period, kind: r.kind, net: r.net, status: r.status }));

  if (!slip) {
    const latest = live[0];
    if (!latest) return { state: "empty" };
    const [found] = await db().select().from(Payslip).where(eq(Payslip._id, latest._id)).limit(1);
    if (!found) return { state: "empty" };
    slip = found;
  }

  const fiscal = fiscalOfPeriod(slip.period);
  const [agg] = await db()
    .select({
      gross: sql<number>`coalesce(sum(${Payslip.gross}), 0)`.mapWith(Number),
      deductions: sql<number>`coalesce(sum(${Payslip.totalDeductions}), 0)`.mapWith(Number),
      net: sql<number>`coalesce(sum(${Payslip.net}), 0)`.mapWith(Number),
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(Payslip)
    .where(and(eq(Payslip.user, slip.user), eq(Payslip.status, "paid"), gte(Payslip.period, fiscal.from), lte(Payslip.period, fiscal.to)));
  return {
    state: "ok",
    data: {
      slip,
      list,
      owner: slip.user === viewer.id,
      fy: { label: fiscal.label, gross: round2(agg?.gross ?? 0), deductions: round2(agg?.deductions ?? 0), net: round2(agg?.net ?? 0), count: agg?.count ?? 0 },
    },
  };
}
