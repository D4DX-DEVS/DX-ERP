import { can, getCurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { PayrollRun, Payslip, User, type PayLine } from "@/lib/models";
import { audit } from "@/lib/audit";
import { exportResponse, isExportFormat } from "@/lib/export";
import { round2 } from "@/lib/format";
import { statusLabel } from "@/lib/status";
import { isObjectId } from "@/lib/validation";
import { KIND_LABEL, periodLabel } from "@/lib/payroll/constants";

/** Groups pay lines that differ only by person-specific wording (one reimbursement per claim, one recovery per advance). */
function componentName(line: PayLine): string {
  if (line.key?.startsWith("reimb:")) return "Reimbursements";
  if (line.key?.startsWith("advance:")) return "Salary advance recovery";
  return line.name;
}

/** GET /payroll/<id>/export?type=register|bank|summary&format=csv|xlsx|pdf (requires `payroll.view`). */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  if (!can(user, "payroll.view")) return new Response("You don't have access to payroll.", { status: 403 });
  const { id } = await ctx.params;
  if (!isObjectId(id)) return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  if (!isExportFormat(format)) return new Response("Unsupported format", { status: 400 });
  const type = url.searchParams.get("type") ?? "register";
  if (type !== "register" && type !== "bank" && type !== "summary") return new Response("Unsupported export type", { status: 400 });

  await connectDB();
  const run = await PayrollRun.findById(id).lean();
  if (!run) return new Response("Not found", { status: 404 });
  const payslips = await Payslip.find({ run: run._id }).sort({ "snapshot.name": 1 }).lean();
  const label = `${KIND_LABEL[run.kind]} ${periodLabel(run.period)}`;
  const subtitle = `${label} · ${run.runNo} · ${statusLabel("payrollRun", run.status)}`;
  const filename = `${run.kind === "salary" ? "payroll" : "stipends"}-${run.period}`;

  if (type === "bank") {
    // Full account numbers: payment or confidential-record access is required, not just payroll.view.
    if (!can(user, "payroll.pay") && !can(user, "staff.confidential")) return new Response("The bank file needs payroll payment or confidential-record access.", { status: 403 });
    if (run.status !== "approved" && run.status !== "paid") return new Response("The bank file is available once the run is approved.", { status: 409 });
    await audit(user, { action: "export", entity: "payroll_run", entityId: run._id, ref: run.runNo, summary: `Exported ${type} for ${label} (${format.toUpperCase()})` });
    const pending = payslips.filter((p) => p.status === "approved");
    const list = (pending.length > 0 ? pending : payslips.filter((p) => p.status === "paid")).filter((p) => p.net > 0);
    // The approved snapshot is what was signed off; today's bank record only fills gaps (a change after approval must not redirect the payment).
    const users = await User.find({ _id: { $in: list.map((p) => p.user) } }, { bank: 1 }).lean();
    const bank = new Map(users.map((u) => [u._id.toString(), u.bank]));
    return exportResponse({
      title: `Bank transfer file · ${label}`,
      filename: `bank-${filename}`,
      format,
      subtitle,
      rows: list,
      columns: [
        { header: "Employee ID", value: (p) => p.snapshot.employeeId },
        { header: "Account holder", value: (p) => (p.snapshot.bankAccount ? p.snapshot.name : bank.get(p.user.toString())?.accountName || p.snapshot.name), width: 28 },
        { header: "Account number", value: (p) => p.snapshot.bankAccount || bank.get(p.user.toString())?.accountNumber || "", width: 22 },
        { header: "IFSC", value: (p) => p.snapshot.ifsc || bank.get(p.user.toString())?.ifsc || "" },
        { header: "Bank", value: (p) => p.snapshot.bankName || bank.get(p.user.toString())?.bankName || "", width: 22 },
        { header: "Net amount", value: (p) => p.net, type: "money" },
        { header: "Narration", value: () => `${KIND_LABEL[run.kind]} ${periodLabel(run.period)}`, width: 24 },
        { header: "Check", value: (p) => (bank.get(p.user.toString())?.accountNumber || p.snapshot.bankAccount ? "" : "Missing bank details") },
      ],
    });
  }
  await audit(user, { action: "export", entity: "payroll_run", entityId: run._id, ref: run.runNo, summary: `Exported ${type} for ${label} (${format.toUpperCase()})` });

  if (type === "summary") {
    const totals = new Map<string, { kind: "Earning" | "Deduction"; name: string; people: number; amount: number }>();
    const add = (kind: "Earning" | "Deduction", lines: PayLine[]) => {
      const perPerson = new Map<string, number>();
      for (const l of lines) perPerson.set(componentName(l), round2((perPerson.get(componentName(l)) ?? 0) + l.amount));
      for (const [name, amount] of perPerson) {
        const key = `${kind}|${name}`;
        const row = totals.get(key) ?? { kind, name, people: 0, amount: 0 };
        row.people += 1;
        row.amount = round2(row.amount + amount);
        totals.set(key, row);
      }
    };
    for (const p of payslips) {
      add("Earning", p.earnings);
      add("Deduction", p.deductions);
    }
    const rows = [...totals.values()].sort((a, b) => (a.kind === b.kind ? b.amount - a.amount : a.kind === "Earning" ? -1 : 1));
    rows.push(
      { kind: "Earning", name: "Gross earnings (total)", people: payslips.length, amount: run.totals.gross },
      { kind: "Deduction", name: "Total deductions", people: payslips.length, amount: run.totals.deductions },
      { kind: "Earning", name: "Net payable", people: payslips.length, amount: run.totals.net },
    );
    return exportResponse({
      title: `Component summary · ${label}`,
      filename: `summary-${filename}`,
      format,
      subtitle,
      rows,
      columns: [
        { header: "Type", value: (r) => r.kind },
        { header: "Component", value: (r) => r.name, width: 34 },
        { header: "People", value: (r) => r.people, type: "number" },
        { header: "Amount", value: (r) => r.amount, type: "money" },
      ],
    });
  }

  return exportResponse({
    title: `Payslip register · ${label}`,
    filename: `register-${filename}`,
    format,
    subtitle,
    rows: payslips,
    columns: [
      { header: "Employee ID", value: (p) => p.snapshot.employeeId },
      { header: "Name", value: (p) => p.snapshot.name, width: 26 },
      { header: "Department", value: (p) => p.snapshot.department ?? "", width: 18 },
      { header: "Pay days", value: (p) => p.workingDays, type: "number" },
      { header: "Payable days", value: (p) => p.payableDays, type: "number" },
      { header: "LOP days", value: (p) => p.lopDays, type: "number" },
      { header: "Gross", value: (p) => p.gross, type: "money" },
      { header: "Deductions", value: (p) => p.totalDeductions, type: "money" },
      { header: "Net", value: (p) => p.net, type: "money" },
      { header: "Status", value: (p) => statusLabel("payslip", p.status) },
      { header: "Paid on", value: (p) => p.payment?.date ?? "" },
      { header: "Payment ref.", value: (p) => p.payment?.reference ?? "" },
    ],
  });
}
