import { audit } from "@/lib/audit";
import { can, getCurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { leaveYearOf, leaveYearRange } from "@/lib/domain/leave-balance";
import { exportResponse, isExportFormat } from "@/lib/export";
import { Department, LeaveRequest, User } from "@/lib/models";
import { idParam, param, type SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
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

  await connectDB();
  const settings = await getSettings();
  const year = leaveYearRange(leaveYearOf(todayKey(), settings), settings);
  const from = dayParam(sp, "from") ?? year.from;
  const to = dayParam(sp, "to") ?? year.to;
  if (to < from) return new Response("The end date is before the start date.", { status: 400 });
  const userId = idParam(sp, "user");

  const requests = await LeaveRequest.find({ ...(userId ? { user: userId } : {}), startDate: { $lte: to }, endDate: { $gte: from } }).sort({ startDate: 1, requestNo: 1 }).lean();
  const [people, departments] = await Promise.all([User.find({ _id: { $in: requests.map((r) => r.user) } }, { name: 1, employeeId: 1, department: 1 }).lean(), Department.find({}, { name: 1 }).lean()]);
  const deptName = new Map(departments.map((d) => [d._id.toString(), d.name]));
  const byId = new Map(people.map((p) => [p._id.toString(), p]));
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
      { header: "Employee ID", value: (r) => byId.get(r.user.toString())?.employeeId ?? "", width: 14 },
      { header: "Name", value: (r) => byId.get(r.user.toString())?.name ?? "", width: 24 },
      { header: "Department", value: (r) => {
          const d = byId.get(r.user.toString())?.department;
          return d ? (deptName.get(d.toString()) ?? "") : "";
        }, width: 18 },
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
