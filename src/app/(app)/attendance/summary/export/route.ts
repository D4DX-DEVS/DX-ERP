import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/session";
import { exportResponse, isExportFormat } from "@/lib/export";
import { idParam, param, type SearchParams } from "@/lib/query";
import { fmtDate, monthKey } from "@/lib/time";
import { attendanceAccess } from "../../_lib/access";
import { validMonthParam } from "../../_lib/params";
import { loadSummary } from "../../_lib/register";

/** Monthly attendance summary export (CSV / XLSX / PDF) for the same filters as the summary page. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Please sign in.", { status: 401 });
  const access = await attendanceAccess(user);
  if (!access.canViewTeam) return new Response("You don't have access to attendance summaries.", { status: 403 });

  const sp: SearchParams = Object.fromEntries(new URL(request.url).searchParams.entries());
  const format = param(sp, "format") || "csv";
  if (!isExportFormat(format)) return new Response("Unknown export format.", { status: 400 });
  const month = validMonthParam(sp, "month") ?? monthKey();
  const q = param(sp, "q");
  const dept = idParam(sp, "dept");

  const { rows, departments } = await loadSummary(access, { month, q, dept });
  await audit(user, { action: "export", entity: "attendance", ref: month, summary: `Exported the attendance summary for ${fmtDate(`${month}-01`, "MMMM yyyy")} (${rows.length} people, ${format.toUpperCase()})` });

  return exportResponse({
    title: `Attendance summary · ${fmtDate(`${month}-01`, "MMMM yyyy")}`,
    filename: `attendance-summary-${month}`,
    subtitle: [q && `search "${q}"`, dept && `department ${departments.find((d) => d.id === dept)?.name ?? ""}`].filter(Boolean).join(", ") || undefined,
    format,
    rows,
    columns: [
      { header: "Employee ID", value: (r) => r.employeeId, width: 14 },
      { header: "Name", value: (r) => r.name, width: 24 },
      { header: "Department", value: (r) => r.department ?? "", width: 18 },
      { header: "Type", value: (r) => r.personType },
      { header: "Working days", type: "number", value: (r) => r.summary.workingDays },
      { header: "Present", type: "number", value: (r) => r.summary.present },
      { header: "Half days", type: "number", value: (r) => r.summary.halfDays },
      { header: "Absent", type: "number", value: (r) => r.summary.absent },
      { header: "Leave", type: "number", value: (r) => r.summary.leaveDays },
      { header: "Late", type: "number", value: (r) => r.summary.lateCount },
      { header: "Early departures", type: "number", value: (r) => r.summary.earlyCount },
      { header: "Missing check-out", type: "number", value: (r) => r.summary.missingCheckout },
      { header: "Total hours", type: "number", value: (r) => Math.round((r.summary.workMinutes / 60) * 100) / 100 },
    ],
  });
}
