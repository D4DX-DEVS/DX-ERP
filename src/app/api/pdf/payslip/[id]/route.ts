import { getCurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { PayrollRun, Payslip } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { isObjectId } from "@/lib/validation";
import { fmtDate } from "@/lib/time";
import { createDoc, finalize, heading, keyValues, pdfMoney, pdfResponse, pdfText, PDF_COLORS, table } from "@/lib/pdf/base";
import { maskTail } from "@/lib/payroll/calc";
import { periodLabel } from "@/lib/payroll/constants";
import { rupeesInWords } from "@/lib/payroll/words";
import { audit } from "@/lib/audit";
import { payslipAccess } from "@/app/(app)/payslips/data";

/** GET /api/pdf/payslip/<id> — payslip PDF for its owner (once approved) and for `payroll.view` users. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  const { id } = await ctx.params;
  if (!isObjectId(id)) return new Response("Not found", { status: 404 });

  await connectDB();
  const slip = await Payslip.findById(id).lean();
  if (!slip) return new Response("Not found", { status: 404 });
  const access = payslipAccess(user, slip);
  if (access === "hidden") return new Response("Not found", { status: 404 });
  if (access === "forbidden") return new Response("You don't have access to this payslip.", { status: 403 });

  const [settings, run] = await Promise.all([getSettings(), PayrollRun.findById(slip.run, { runNo: 1 }).lean()]);
  const stipend = slip.kind === "stipend";
  const paid = slip.status === "paid";
  const footer = settings.documents.payslipFooter;

  const b = createDoc({
    title: stipend ? "STIPEND STATEMENT" : "PAYSLIP",
    company: settings.company,
    meta: [periodLabel(slip.period), paid && slip.payment?.date ? `Paid ${fmtDate(slip.payment.date)}` : slip.status === "approved" ? "Approved - payment pending" : "Draft", run ? run.runNo : ""].filter(Boolean),
  });
  const { doc } = b;
  const pageH = doc.internal.pageSize.getHeight();
  const rightX = b.width - b.margin;
  let y = b.y;

  // --- employee block ----------------------------------------------------------------------------------
  const mid = b.margin + (b.width - b.margin * 2) / 2 + 4;
  const left = keyValues(
    b,
    [
      ["Employee", slip.snapshot.name],
      ["Employee ID", slip.snapshot.employeeId],
      ["Designation", slip.snapshot.designation ?? "-"],
      ["Department", slip.snapshot.department ?? "-"],
    ],
    y,
    b.margin,
    30,
  );
  const right = keyValues(
    b,
    [
      ["Date of joining", slip.snapshot.joiningDate ? fmtDate(slip.snapshot.joiningDate) : "-"],
      ["PAN", slip.snapshot.pan ? maskTail(slip.snapshot.pan, 5, "X") : "-"],
      ["Bank", slip.snapshot.bankAccount ? `${slip.snapshot.bankName ?? "Account"} ${maskTail(slip.snapshot.bankAccount, 4, "X")}` : "-"],
      ["IFSC", slip.snapshot.ifsc ?? "-"],
    ],
    y,
    mid,
    30,
  );
  y = Math.max(left, right) + 3;

  // --- attendance summary ------------------------------------------------------------------------------
  y = heading(b, "Attendance summary", y);
  y =
    table(b, {
      startY: y,
      head: [["Pay days", "Payable days", "Loss of pay", "Present", "On leave"]],
      body: [[String(slip.workingDays), String(slip.payableDays), String(slip.lopDays), String(slip.presentDays), String(slip.leaveDays)]],
      styles: { halign: "center" },
    }) + 7;

  // --- earnings and deductions ---------------------------------------------------------------------------
  const rows = Math.max(slip.earnings.length, slip.deductions.length, 1);
  const body: string[][] = [];
  for (let i = 0; i < rows; i++) {
    const e = slip.earnings[i];
    const d = slip.deductions[i];
    body.push([e?.name ?? "", e ? pdfMoney(e.amount) : "", d?.name ?? "", d ? pdfMoney(d.amount) : ""]);
  }
  y =
    table(b, {
      startY: y,
      head: [["Earnings", "Amount", "Deductions", "Amount"]],
      body,
      foot: [["Gross earnings", pdfMoney(slip.gross), "Total deductions", pdfMoney(slip.totalDeductions)]],
      showFoot: "lastPage",
      columnStyles: { 1: { halign: "right", cellWidth: 30 }, 3: { halign: "right", cellWidth: 30 } },
    }) + 8;

  // --- net pay ---------------------------------------------------------------------------------------------------
  if (y + 40 > pageH - 20) {
    doc.addPage();
    y = 20;
  }
  doc.setFillColor(...PDF_COLORS.navy);
  doc.roundedRect(b.margin, y, b.width - b.margin * 2, 18, 2, 2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text("Net pay", b.margin + 5, y + 6.5);
  doc.setFontSize(8);
  doc.text(pdfText(rupeesInWords(slip.net)), b.margin + 5, y + 12.5, { maxWidth: 110 });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(pdfMoney(slip.net), rightX - 5, y + 11.5, { align: "right" });
  y += 26;

  // --- payment details -----------------------------------------------------------------------------------------
  y = heading(b, "Payment details", y);
  y = keyValues(
    b,
    paid && slip.payment?.date
      ? [
          ["Paid on", fmtDate(slip.payment.date)],
          ["Method", slip.payment.method ?? "-"],
          ["Reference", slip.payment.reference ?? "-"],
        ]
      : [["Status", slip.status === "approved" ? "Approved - payment pending" : "Draft - not final"]],
    y,
    b.margin,
    30,
  );
  if (slip.totalDeductions > slip.gross) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    doc.setTextColor(...PDF_COLORS.muted);
    doc.text("Deductions exceeded earnings for this period, so net pay is held at zero.", b.margin, y + 2);
  }

  finalize(b, footer || "This is a system-generated payslip and does not require a signature.");
  if (slip.user.toString() !== user.id) {
    await audit(user, { action: "access", entity: "payslip", entityId: slip._id, ref: slip.snapshot.name, summary: `Downloaded the ${periodLabel(slip.period)} payslip of ${slip.snapshot.name}` });
  }
  return pdfResponse(doc, `Payslip-${slip.period}-${slip.snapshot.employeeId}.pdf`);
}
