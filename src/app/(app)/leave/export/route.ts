import { and, asc, eq, gte, lte } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { can, getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { leaveYearOf, leaveYearRange } from "@/lib/domain/leave-balance";
import { exportResponse, isExportFormat } from "@/lib/export";
import { Department, LeaveRequest, User } from "@/lib/models";
import { idParam, param, type SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { inList } from "@/lib/sql";
import { statusLabel } from "@/lib/status";
import { fmtDate, todayKey } from "@/lib/time";
import { dayParam } from "../../attendance/_lib/params";

/** Leave report by employee and date range (CSV / XLSX / PDF). Requests overlapping the range are included. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Please sign in.", { status: 401 });
  if (!can(user, "leave.view_all") && !can(user, "leave.manage")) return new Response("You don't have access to the leave report.", { status: 403 });

  const sp: SearchParams = Object.fromEntries(new URL(request.url).searchParams.entries());
  const format = param(sp, "format") || "csv";
  if (!isExportFormat(format)) return new Response("Unknown export format.", { status: 400 });

  const settings = await getSettings();
  const year = leaveYearRange(leaveYearOf(todayKey(), settings), settings);
  const from = dayParam(sp, "from") ?? year.from;
  const to = dayParam(sp, "to") ?? year.to;
  if (to < from) return new Response("The end date is before the start date.", { status: 400 });
  const userId = idParam(sp, "user");

  const requests = await db()
    .select()
    .from(LeaveRequest)
    .where(and(userId ? eq(LeaveRequest.user, userId) : undefined, lte(LeaveRequest.startDate, to), gte(LeaveRequest.endDate, from)))
    .orderBy(asc(LeaveRequest.startDate), asc(LeaveRequest.requestNo));
  const people = await db()
    .select({ _id: User._id, name: User.name, employeeId: User.employeeId, deptName: Department.name })
    .from(User)
    .leftJoin(Department, eq(Department._id, User.department))
    .where(
      inList(
        User._id,
        requests.map((r) => r.user),
      ),
    );
  const byId = new Map(people.map((p) => [p._id, p]));
  const subject = userId ? byId.get(userId)?.name : undefined;

  await audit(user, { action: "export", entity: "leave", ref: `${from}..${to}`, summary: `Exported the leave report ${fmtDate(from)} – ${fmtDate(to)}${subject ? ` for ${subject}` : ""} (${requests.length} requests, ${format.toUpperCase()})` });

  return exportResponse({
    title: "Leave report",
    filename: `leave-report-${from}-to-${to}`,
    subtitle: `${fmtDate(from)} – ${fmtDate(to)}${subject ? ` · ${subject}` : ""}`,
    format,
    rows: requests,
    columns: [
      { header: "Request", value: (r) => r.requestNo, width: 12 },
      { header: "Employee ID", value: (r) => byId.get(r.user)?.employeeId ?? "", width: 14 },
      { header: "Name", value: (r) => byId.get(r.user)?.name ?? "", width: 24 },
      { header: "Department", value: (r) => byId.get(r.user)?.deptName ?? "", width: 18 },
      { header: "Leave type", value: (r) => r.leaveTypeName ?? "", width: 16 },
      { header: "From", value: (r) => r.startDate },
      { header: "To", value: (r) => r.endDate },
      { header: "Half day", value: (r) => (r.halfDay ? (r.halfDaySession === "second" ? "Second half" : "First half") : "") },
      { header: "Days", type: "number", value: (r) => r.days },
      { header: "Status", value: (r) => statusLabel("leave", r.status), width: 16 },
      { header: "Applied on", value: (r) => fmtDate(r.createdAt) },
      { header: "Decided by", value: (r) => r.approvals.at(-1)?.byName ?? "", width: 20 },
      { header: "Reason", value: (r) => r.reason, width: 36 },
    ],
  });
}
