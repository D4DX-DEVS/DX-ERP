import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/session";
import { exportResponse, isExportFormat } from "@/lib/export";
import { idParam, param, type SearchParams } from "@/lib/query";
import { fmtDate, timeOf, todayKey } from "@/lib/time";
import { attendanceAccess } from "../../_lib/access";
import { dayParam } from "../../_lib/params";
import { isEarly, isLate, loadRegister, matchesStatus, REGISTER_STATUS_OPTIONS, rowStatusText } from "../../_lib/register";

/** Daily attendance register export (CSV / XLSX / PDF) for the same filters as the Team register page. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Please sign in.", { status: 401 });
  const access = await attendanceAccess(user);
  if (!access.canViewTeam) return new Response("You don't have access to the team register.", { status: 403 });

  const sp: SearchParams = Object.fromEntries(new URL(request.url).searchParams.entries());
  const format = param(sp, "format") || "csv";
  if (!isExportFormat(format)) return new Response("Unknown export format.", { status: 400 });
  const date = dayParam(sp, "date") ?? todayKey();
  const q = param(sp, "q");
  const dept = idParam(sp, "dept");
  const status = param(sp, "status");

  const register = await loadRegister(access, { date, q, dept });
  const rows = register.rows.filter((r) => matchesStatus(r, status));

  const filters = [
    q && `search "${q}"`,
    dept && `department ${register.departments.find((d) => d.id === dept)?.name ?? ""}`,
    status && `status ${REGISTER_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status}`,
  ].filter(Boolean);

  await audit(user, { action: "export", entity: "attendance", ref: date, summary: `Exported the daily attendance register for ${fmtDate(date)} (${rows.length} people, ${format.toUpperCase()})` });

  return exportResponse({
    title: `Daily attendance · ${fmtDate(date, "EEE d MMM yyyy")}`,
    filename: `attendance-${date}`,
    subtitle: filters.length ? `Filters: ${filters.join(", ")}` : undefined,
    format,
    rows,
    columns: [
      { header: "Employee ID", value: (r) => r.employeeId, width: 14 },
      { header: "Name", value: (r) => r.name, width: 24 },
      { header: "Department", value: (r) => r.department ?? "", width: 18 },
      { header: "Type", value: (r) => r.personType },
      { header: "Status", value: (r) => rowStatusText(r), width: 20 },
      { header: "Check-in", value: (r) => (r.checkIn ? timeOf(r.checkIn) : "") },
      { header: "Check-out", value: (r) => (r.checkOut ? timeOf(r.checkOut) : "") },
      { header: "Break (min)", type: "number", value: (r) => (r.checkIn ? r.breakMinutes : "") },
      { header: "Worked (min)", type: "number", value: (r) => r.workMinutes ?? "" },
      { header: "Late (min)", type: "number", value: (r) => (isLate(r) ? r.lateMinutes : "") },
      { header: "Early (min)", type: "number", value: (r) => (isEarly(r) ? r.earlyMinutes : "") },
      { header: "Outside now", value: (r) => (r.outside ? "Yes" : "") },
      { header: "Movements", type: "number", value: (r) => r.movementCount },
      { header: "Movement (min)", type: "number", value: (r) => r.movementMinutes },
      { header: "Note", value: (r) => r.note ?? "", width: 24 },
    ],
  });
}
