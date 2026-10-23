import "server-only";
import { can, type CurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { PayrollRun, Payslip, type IPayslip } from "@/lib/models";
import { isObjectId } from "@/lib/validation";
import { round2 } from "@/lib/format";

/**
 * Who may open a payslip: its owner once it is approved or paid, and anyone with `payroll.view`.
 * "hidden" is used for a draft that belongs to the viewer (they get a 404, not a hint that it exists).
 */
export function payslipAccess(viewer: CurrentUser, slip: Pick<IPayslip, "user" | "status">): "ok" | "forbidden" | "hidden" {
  if (can(viewer, "payroll.view")) return "ok";
  if (slip.user.toString() !== viewer.id) return "forbidden";
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
  await connectDB();
  let slip: IPayslip | null = null;
  if (id) {
    if (!isObjectId(id)) return { state: "notfound" };
    slip = await Payslip.findById(id).lean();
    if (!slip) return { state: "notfound" };
    const access = payslipAccess(viewer, slip);
    if (access === "forbidden") return { state: "forbidden" };
    if (access === "hidden") return { state: "notfound" };
  }

  const ownerId = slip ? slip.user : viewer._id;
  const seeAll = can(viewer, "payroll.view");
  const showDrafts = seeAll && Boolean(slip);
  const rows = await Payslip.find(
    { user: ownerId, ...(showDrafts ? {} : { status: { $in: ["approved", "paid"] } }) },
    { period: 1, kind: 1, net: 1, status: 1, run: 1 },
  )
    .sort({ period: -1, createdAt: -1 })
    .lean();
  const runs = await PayrollRun.find({ _id: { $in: rows.map((r) => r.run) } }, { status: 1 }).lean();
  const cancelled = new Set(runs.filter((r) => r.status === "cancelled").map((r) => r._id.toString()));
  const live = rows.filter((r) => !cancelled.has(r.run.toString()));
  const list: PayslipListItem[] = live.map((r) => ({ id: r._id.toString(), period: r.period, kind: r.kind, net: r.net, status: r.status }));

  if (!slip) {
    const latest = live[0];
    if (!latest) return { state: "empty" };
    slip = await Payslip.findById(latest._id).lean();
    if (!slip) return { state: "empty" };
  }

  const fiscal = fiscalOfPeriod(slip.period);
  const [agg] = await Payslip.aggregate<{ gross: number; deductions: number; net: number; count: number }>([
    { $match: { user: slip.user, status: "paid", period: { $gte: fiscal.from, $lte: fiscal.to } } },
    { $group: { _id: null, gross: { $sum: "$gross" }, deductions: { $sum: "$totalDeductions" }, net: { $sum: "$net" }, count: { $sum: 1 } } },
  ]);
  return {
    state: "ok",
    data: {
      slip,
      list,
      owner: slip.user.toString() === viewer.id,
      fy: { label: fiscal.label, gross: round2(agg?.gross ?? 0), deductions: round2(agg?.deductions ?? 0), net: round2(agg?.net ?? 0), count: agg?.count ?? 0 },
    },
  };
}
