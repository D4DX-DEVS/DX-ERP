import "server-only";
import { can, type CurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Movement, type IMovement } from "@/lib/models";
import type { ExportColumn } from "@/lib/export";
import type { AppSettings } from "@/lib/config-defaults";
import { getSettings } from "@/lib/settings";
import { statusLabel } from "@/lib/status";
import { fmtDate, fmtDateTime, fmtTime, formatDuration, todayKey } from "@/lib/time";
import {
  clientNames,
  DEFAULTS,
  DEPARTMENT_FILTER,
  hoursOf,
  PERSON_FILTER,
  peopleMap,
  projectMap,
  rangeOf,
  RANGE_FILTERS,
  userScope,
  type PersonInfo,
} from "./shared";
import { defineReport, type ReportFilterDef, type ReportFilters } from "./types";

const MOVEMENT = ["reports.view", "reports.hr"] as const;

const APPROVAL_FILTER: ReportFilterDef = {
  key: "approval",
  label: "Approval status",
  type: "select",
  options: ["not_required", "pending", "approved", "rejected", "correction_requested"].map((s) => ({ value: s, label: statusLabel("movementApproval", s) })),
};
const CATEGORY_FILTER: ReportFilterDef = { key: "category", label: "Category", type: "select", optionsFrom: "movementCategories" };
const MOVE_FILTERS: ReportFilterDef[] = [...RANGE_FILTERS, PERSON_FILTER, DEPARTMENT_FILTER, CATEGORY_FILTER, APPROVAL_FILTER];

/** One movement prepared for reporting. Personal details are already masked for the viewer. */
interface MoveRow {
  person: PersonInfo;
  id: string;
  movementNo: string;
  date: string;
  category: string;
  official: boolean;
  purpose: string;
  destination: string;
  remarks: string;
  project: string;
  client: string;
  outTime?: Date;
  expectedReturn?: Date;
  inTime?: Date;
  minutes?: number;
  status: string;
  approval: string;
  approver: string;
  approvedAt?: Date;
  approvalNote: string;
  entryMode: string;
  enteredBy: string;
  alternativeReason: string;
  lateByMinutes: number;
  open: boolean;
}

function displayStatus(m: Pick<IMovement, "status" | "date" | "expectedReturn">, settings: AppSettings, today: string): string {
  if (m.status === "out") {
    if (m.date < today) return "Missing In-Time";
    if (m.expectedReturn && Date.now() > m.expectedReturn.getTime() + settings.movement.overdueGraceMinutes * 60_000) return "Overdue";
  }
  return statusLabel("movement", m.status);
}

/** Minutes past the expected return (plus grace) — for returned movements measured at In-Time, for open ones at "now". */
function lateBy(m: Pick<IMovement, "status" | "expectedReturn" | "inTime">, settings: AppSettings): number {
  if (!m.expectedReturn) return 0;
  const grace = settings.movement.overdueGraceMinutes;
  const reference = m.status === "returned" ? m.inTime : m.status === "out" ? new Date() : undefined;
  if (!reference) return 0;
  const late = Math.round((reference.getTime() - m.expectedReturn.getTime()) / 60_000);
  return late > grace ? late : 0;
}

interface MovementQuery {
  /** Single `date` filter (daily register) instead of a from / to range. */
  singleDate?: boolean;
  extra?: Record<string, unknown>;
}

/** Loads movements for the filters, resolves names and masks personal details the viewer may not read. */
async function loadMovements(f: ReportFilters, user: CurrentUser, query: MovementQuery = {}): Promise<{ rows: MoveRow[]; settings: AppSettings; showPersonal: boolean }> {
  await connectDB();
  const settings = await getSettings();
  const showPersonal = can(user, "movement.view_personal");
  const today = todayKey();
  const filter: Record<string, unknown> = { status: { $ne: "draft" }, ...(await userScope(f)), ...query.extra };
  if (query.singleDate) filter.date = f.date || today;
  else {
    const { from, to } = rangeOf(f);
    filter.date = { $gte: from, $lte: to };
  }
  // Without `movement.view_personal` a personal category can't be used as a filter (it would reveal who had one).
  if (f.category && (showPersonal || settings.movement.categories.find((c) => c.key === f.category)?.official)) filter.category = f.category;
  if (f.approval) filter.approvalStatus = f.approval;

  const docs = await Movement.find(filter, { history: 0 }).sort({ date: 1, outTime: 1 }).limit(20_000).lean();
  const [people, projects, clients] = await Promise.all([
    peopleMap([...docs.map((d) => d.user), ...docs.map((d) => d.approver), ...docs.map((d) => d.approvedBy)]),
    projectMap(docs.map((d) => d.project)),
    clientNames(docs.map((d) => d.client), user),
  ]);

  const rows: MoveRow[] = docs.flatMap((d) => {
    const person = people.get(d.user.toString());
    if (!person) return [];
    const hide = !d.official && !showPersonal;
    const project = d.project ? projects.get(d.project.toString()) : undefined;
    return [
      {
        person,
        id: d._id.toString(),
        movementNo: d.movementNo,
        date: d.date,
        category: d.official ? d.categoryLabel : hide ? "Personal" : d.categoryLabel,
        official: d.official,
        purpose: hide ? "Personal" : d.purpose,
        destination: hide ? "" : (d.destination ?? ""),
        remarks: hide ? "" : (d.remarks ?? ""),
        project: project ? `${project.projectNo} · ${project.title}` : "",
        client: d.client ? (clients.get(d.client.toString()) ?? "") : "",
        outTime: d.outTime,
        expectedReturn: d.expectedReturn,
        inTime: d.inTime,
        minutes: d.durationMinutes,
        status: displayStatus(d, settings, today),
        approval: statusLabel("movementApproval", d.approvalStatus),
        approver: (d.approvedBy ? people.get(d.approvedBy.toString())?.name : undefined) ?? d.approvedByName ?? (d.approver ? (people.get(d.approver.toString())?.name ?? "") : ""),
        approvedAt: d.approvedAt,
        approvalNote: hide ? "" : (d.approvalNote ?? ""),
        entryMode: d.entryMode === "alternative" ? "Alternative entry" : "Live",
        enteredBy: d.enteredByName ?? "",
        alternativeReason: hide ? "" : (d.alternativeReason ?? ""),
        lateByMinutes: lateBy(d, settings),
        open: d.status === "out",
      },
    ];
  });
  return { rows, settings, showPersonal };
}

type Col = ExportColumn<MoveRow>;
const C = {
  no: { header: "Movement", value: (r) => r.movementNo } as Col,
  date: { header: "Date", value: (r) => fmtDate(r.date) } as Col,
  empId: { header: "Employee ID", value: (r) => r.person.employeeId } as Col,
  employee: { header: "Employee", value: (r) => r.person.name, width: 24 } as Col,
  department: { header: "Department", value: (r) => r.person.department, width: 20 } as Col,
  category: { header: "Category", value: (r) => r.category, width: 20 } as Col,
  purpose: { header: "Purpose", value: (r) => r.purpose, width: 34 } as Col,
  destination: { header: "Destination", value: (r) => r.destination, width: 24 } as Col,
  out: { header: "Out", value: (r) => (r.outTime ? fmtTime(r.outTime) : "") } as Col,
  expected: { header: "Expected return", value: (r) => (r.expectedReturn ? fmtTime(r.expectedReturn) : "") } as Col,
  in: { header: "In", value: (r) => (r.inTime ? fmtTime(r.inTime) : "") } as Col,
  duration: { header: "Duration", value: (r) => (r.minutes === undefined ? "" : formatDuration(r.minutes)) } as Col,
  status: { header: "Status", value: (r) => r.status } as Col,
  approval: { header: "Approval", value: (r) => r.approval } as Col,
  type: { header: "Type", value: (r) => (r.official ? "Official" : "Personal") } as Col,
};

function totals(rows: MoveRow[], showPersonal: boolean) {
  const official = rows.filter((r) => r.official).reduce((s, r) => s + (r.minutes ?? 0), 0);
  const personal = rows.filter((r) => !r.official).reduce((s, r) => s + (r.minutes ?? 0), 0);
  return [
    { label: "Movements", value: String(rows.length) },
    { label: "Still out", value: String(rows.filter((r) => r.open).length) },
    { label: "Official time", value: formatDuration(official) },
    ...(showPersonal ? [{ label: "Personal time", value: formatDuration(personal) }] : []),
  ];
}

const MASK_NOTE = "Purpose and destination of personal movements are hidden unless you hold the “See details of personal movements” permission.";

/* ------------------------------------------------------------------ reports */

const movementDaily = defineReport<MoveRow>({
  key: "movement-daily",
  title: "Daily movement register",
  group: "Movement",
  description: "Every Out-Time and In-Time recorded for one day, with purpose, duration and approval.",
  permissions: [...MOVEMENT],
  filters: [{ key: "date", label: "Date", type: "date", defaultValue: DEFAULTS.today }, DEPARTMENT_FILTER, PERSON_FILTER, CATEGORY_FILTER, APPROVAL_FILTER],
  async run(f, user) {
    const { rows, showPersonal } = await loadMovements(f, user, { singleDate: true });
    return {
      columns: [C.no, C.empId, C.employee, C.department, C.category, C.purpose, C.destination, C.out, C.expected, C.in, C.duration, C.status, C.approval],
      rows,
      summary: totals(rows, showPersonal),
      note: MASK_NOTE,
    };
  },
});

const movementHistory = defineReport<MoveRow>({
  key: "movement-history",
  title: "Employee-wise movement history",
  group: "Movement",
  description: "Each person's movements over a period, grouped by person.",
  permissions: [...MOVEMENT],
  filters: [...MOVE_FILTERS],
  async run(f, user) {
    const { rows, showPersonal } = await loadMovements(f, user);
    rows.sort((a, b) => a.person.name.localeCompare(b.person.name) || a.date.localeCompare(b.date) || (a.outTime?.getTime() ?? 0) - (b.outTime?.getTime() ?? 0));
    return {
      columns: [C.empId, C.employee, C.department, C.date, C.no, C.category, C.purpose, C.out, C.in, C.duration, C.status, C.approval],
      rows,
      summary: [...totals(rows, showPersonal), { label: "People", value: String(new Set(rows.map((r) => r.person.id)).size) }],
      note: MASK_NOTE,
    };
  },
});

const movementTimes = defineReport<MoveRow>({
  key: "movement-times",
  title: "In-Time & Out-Time report",
  group: "Movement",
  description: "Exact Out-Time and In-Time stamps with how each entry was made (live or alternative).",
  permissions: [...MOVEMENT],
  filters: [...MOVE_FILTERS],
  async run(f, user) {
    const { rows, showPersonal } = await loadMovements(f, user);
    return {
      columns: [
        C.date,
        C.no,
        C.empId,
        C.employee,
        C.department,
        C.type,
        { header: "Out-Time", value: (r) => (r.outTime ? fmtDateTime(r.outTime) : "") },
        { header: "In-Time", value: (r) => (r.inTime ? fmtDateTime(r.inTime) : "") },
        C.duration,
        { header: "Entry", value: (r) => r.entryMode },
        { header: "Entered by", value: (r) => r.enteredBy },
        { header: "Alternative-entry reason", value: (r) => r.alternativeReason, width: 30 },
        C.status,
      ],
      rows,
      summary: [
        ...totals(rows, showPersonal),
        { label: "Alternative entries", value: String(rows.filter((r) => r.entryMode !== "Live").length) },
      ],
      note: MASK_NOTE,
    };
  },
});

interface DurationRow {
  person: PersonInfo;
  movements: number;
  open: number;
  officialMinutes: number;
  personalMinutes: number;
  totalMinutes: number;
  longestMinutes: number;
}

const movementDuration = defineReport<DurationRow>({
  key: "movement-duration",
  title: "Duration outside office",
  group: "Movement",
  description: "Total time each person spent outside the office, split into official and personal movements.",
  permissions: [...MOVEMENT],
  filters: [...RANGE_FILTERS, DEPARTMENT_FILTER, PERSON_FILTER, CATEGORY_FILTER],
  async run(f, user) {
    const { rows, showPersonal } = await loadMovements(f, user, { extra: { status: { $in: ["out", "returned"] } } });
    const byPerson = new Map<string, DurationRow>();
    for (const r of rows) {
      const row = byPerson.get(r.person.id) ?? { person: r.person, movements: 0, open: 0, officialMinutes: 0, personalMinutes: 0, totalMinutes: 0, longestMinutes: 0 };
      row.movements += 1;
      if (r.open) row.open += 1;
      const minutes = r.minutes ?? 0;
      if (r.official) row.officialMinutes += minutes;
      else row.personalMinutes += minutes;
      row.totalMinutes += showPersonal || r.official ? minutes : 0;
      row.longestMinutes = Math.max(row.longestMinutes, showPersonal || r.official ? minutes : 0);
      byPerson.set(r.person.id, row);
    }
    const out = [...byPerson.values()].sort((a, b) => b.totalMinutes - a.totalMinutes);
    const official = out.reduce((s, r) => s + r.officialMinutes, 0);
    const personal = out.reduce((s, r) => s + r.personalMinutes, 0);
    const columns: ExportColumn<DurationRow>[] = [
      { header: "Employee ID", value: (r) => r.person.employeeId },
      { header: "Employee", value: (r) => r.person.name, width: 24 },
      { header: "Department", value: (r) => r.person.department, width: 20 },
      { header: "Movements", value: (r) => r.movements, type: "number" },
      { header: "Still out (no In-Time)", value: (r) => r.open, type: "number" },
      { header: "Official hours", value: (r) => hoursOf(r.officialMinutes), type: "number" },
      ...(showPersonal ? [{ header: "Personal hours", value: (r: DurationRow) => hoursOf(r.personalMinutes), type: "number" as const }] : []),
      { header: showPersonal ? "Total hours" : "Hours counted", value: (r) => hoursOf(r.totalMinutes), type: "number" },
      { header: "Avg per movement (min)", value: (r) => (r.movements - r.open > 0 ? Math.round(r.totalMinutes / (r.movements - r.open)) : null), type: "number" },
      { header: "Longest (min)", value: (r) => r.longestMinutes, type: "number" },
    ];
    return {
      columns,
      rows: out,
      summary: [
        { label: "Movements", value: String(rows.length) },
        { label: "Official time", value: formatDuration(official) },
        ...(showPersonal ? [{ label: "Personal time", value: formatDuration(personal) }] : []),
        { label: "People", value: String(out.length) },
      ],
      note: "Movements still open have no final duration yet. Personal-movement time is shown only to holders of the personal-movement permission.",
    };
  },
});

const movementOverdue = defineReport<MoveRow>({
  key: "movement-overdue",
  title: "Late returns & overdue movements",
  group: "Movement",
  description: "Movements that returned after the expected time, and movements still out past it.",
  permissions: [...MOVEMENT],
  filters: [...RANGE_FILTERS, DEPARTMENT_FILTER, PERSON_FILTER, CATEGORY_FILTER],
  async run(f, user) {
    const { rows: all, showPersonal } = await loadMovements(f, user, { extra: { status: { $in: ["out", "returned"] }, expectedReturn: { $exists: true } } });
    const rows = all.filter((r) => r.lateByMinutes > 0).sort((a, b) => b.lateByMinutes - a.lateByMinutes);
    return {
      columns: [
        C.date,
        C.no,
        C.empId,
        C.employee,
        C.department,
        C.type,
        C.purpose,
        C.out,
        C.expected,
        C.in,
        { header: "Late by", value: (r) => formatDuration(r.lateByMinutes) },
        { header: "Late by (min)", value: (r) => r.lateByMinutes, type: "number" },
        C.status,
      ],
      rows,
      summary: [
        { label: "Late / overdue", value: String(rows.length) },
        { label: "Still out", value: String(rows.filter((r) => r.open).length) },
        { label: "Average delay", value: rows.length ? formatDuration(rows.reduce((s, r) => s + r.lateByMinutes, 0) / rows.length) : "—" },
        { label: "People", value: String(new Set(rows.map((r) => r.person.id)).size) },
      ],
      note: `Late means beyond the expected return plus the configured grace period. ${showPersonal ? "" : MASK_NOTE}`.trim(),
    };
  },
});

const movementOfficial = defineReport<MoveRow>({
  key: "movement-official",
  title: "Official movement report",
  group: "Movement",
  description: "Official movements (client meetings, project work, official business) with project and client references.",
  permissions: [...MOVEMENT],
  filters: [...MOVE_FILTERS, { key: "project", label: "Project", type: "project" }, { key: "client", label: "Client", type: "client" }],
  async run(f, user) {
    const extra: Record<string, unknown> = { official: true };
    if (f.project) extra.project = f.project;
    if (f.client) extra.client = f.client;
    const { rows, showPersonal } = await loadMovements(f, user, { extra });
    return {
      columns: [
        C.date,
        C.no,
        C.empId,
        C.employee,
        C.department,
        C.category,
        C.purpose,
        C.destination,
        { header: "Project", value: (r) => r.project, width: 28 },
        { header: "Client", value: (r) => r.client, width: 22 },
        C.out,
        C.in,
        C.duration,
        C.approval,
      ],
      rows,
      summary: totals(rows, showPersonal).filter((s) => s.label !== "Personal time"),
    };
  },
});

const movementPersonal = defineReport<MoveRow>({
  key: "movement-personal",
  title: "Personal movement report",
  group: "Movement",
  description: "Personal and non-official movements with full details. Restricted to holders of the personal-movement permission.",
  permissions: [...MOVEMENT, "movement.view_personal"],
  filters: [...MOVE_FILTERS],
  async run(f, user) {
    const { rows } = await loadMovements(f, user, { extra: { official: false } });
    return {
      columns: [C.date, C.no, C.empId, C.employee, C.department, C.category, C.purpose, C.destination, { header: "Remarks", value: (r) => r.remarks, width: 28 }, C.out, C.in, C.duration, C.status, C.approval],
      rows,
      summary: [
        { label: "Personal movements", value: String(rows.length) },
        { label: "Total time", value: formatDuration(rows.reduce((s, r) => s + (r.minutes ?? 0), 0)) },
        { label: "People", value: String(new Set(rows.map((r) => r.person.id)).size) },
      ],
      note: "Restricted report. Exports are recorded in the audit trail.",
    };
  },
});

const movementPending = defineReport<MoveRow>({
  key: "movement-pending",
  title: "Pending & rejected movements",
  group: "Movement",
  description: "Movements awaiting approval, rejected, or sent back for correction.",
  permissions: [...MOVEMENT],
  filters: [...MOVE_FILTERS],
  async run(f, user) {
    const approval = f.approval ? {} : { approvalStatus: { $in: ["pending", "rejected", "correction_requested"] } };
    const { rows, showPersonal } = await loadMovements(f, user, { extra: approval });
    return {
      columns: [
        C.date,
        C.no,
        C.empId,
        C.employee,
        C.department,
        C.category,
        C.purpose,
        C.out,
        C.in,
        C.duration,
        C.approval,
        { header: "Decided by", value: (r) => r.approver },
        { header: "Decided on", value: (r) => (r.approvedAt ? fmtDateTime(r.approvedAt) : "") },
        { header: "Decision note", value: (r) => r.approvalNote, width: 28 },
      ],
      rows,
      summary: [
        { label: "Pending", value: String(rows.filter((r) => r.approval === statusLabel("movementApproval", "pending")).length) },
        { label: "Rejected", value: String(rows.filter((r) => r.approval === statusLabel("movementApproval", "rejected")).length) },
        { label: "Correction requested", value: String(rows.filter((r) => r.approval === statusLabel("movementApproval", "correction_requested")).length) },
      ],
      note: showPersonal ? undefined : MASK_NOTE,
    };
  },
});

interface AuditRow {
  person: PersonInfo;
  movementNo: string;
  date: string;
  event: string;
  by: string;
  at?: Date;
  original: string;
  proposed: string;
  outcome: string;
  note: string;
}

const movementAudit = defineReport<AuditRow>({
  key: "movement-audit",
  title: "Correction & approval audit",
  group: "Movement",
  description: "Correction requests, approval decisions, alternative entries and manual resolutions with who did what and when.",
  permissions: [...MOVEMENT],
  filters: [...RANGE_FILTERS, DEPARTMENT_FILTER, PERSON_FILTER],
  async run(f, user) {
    await connectDB();
    const showPersonal = can(user, "movement.view_personal");
    const { from, to } = rangeOf(f);
    const docs = await Movement.find(
      {
        date: { $gte: from, $lte: to },
        ...(await userScope(f)),
        $or: [{ "corrections.0": { $exists: true } }, { approvedBy: { $exists: true } }, { entryMode: "alternative" }, { resolvedBy: { $exists: true } }],
      },
      { history: 0 },
    )
      .sort({ date: -1 })
      .limit(5000)
      .lean();
    const people = await peopleMap(docs.map((d) => d.user));
    const range = (a?: Date, b?: Date) => `${a ? fmtDateTime(a) : "—"} → ${b ? fmtDateTime(b) : "—"}`;
    const rows: AuditRow[] = [];
    for (const d of docs) {
      const person = people.get(d.user.toString());
      if (!person) continue;
      const hide = !d.official && !showPersonal;
      const text = (v?: string) => (hide ? "" : (v ?? ""));
      const base = { person, movementNo: d.movementNo, date: d.date };
      if (d.entryMode === "alternative") {
        rows.push({ ...base, event: "Alternative entry", by: d.enteredByName ?? "", at: d.createdAt, original: "", proposed: range(d.outTime, d.inTime), outcome: "Recorded after the fact", note: text(d.alternativeReason) });
      }
      for (const c of d.corrections) {
        rows.push({
          ...base,
          event: "Correction request",
          by: c.requestedByName,
          at: c.requestedAt,
          original: range(c.originalOutTime, c.originalInTime),
          proposed: range(c.proposedOutTime, c.proposedInTime),
          outcome: `${titleCaseStatus(c.status)}${c.reviewedByName ? ` by ${c.reviewedByName}` : ""}${c.reviewedAt ? ` on ${fmtDateTime(c.reviewedAt)}` : ""}`,
          note: [text(c.reason), text(c.reviewNote)].filter(Boolean).join(" — "),
        });
      }
      if (d.approvedBy || d.approvedByName) {
        rows.push({ ...base, event: "Approval decision", by: d.approvedByName ?? "", at: d.approvedAt, original: "", proposed: "", outcome: statusLabel("movementApproval", d.approvalStatus), note: text(d.approvalNote) });
      }
      if (d.resolvedBy || d.resolvedByName) {
        rows.push({ ...base, event: "Resolved by authorised user", by: d.resolvedByName ?? "", at: d.updatedAt, original: "", proposed: range(d.outTime, d.inTime), outcome: "Closed without a live In-Time", note: text(d.resolutionNote) });
      }
    }
    rows.sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
    const count = (event: string) => rows.filter((r) => r.event === event).length;
    return {
      columns: [
        { header: "Date", value: (r) => fmtDate(r.date) },
        { header: "Movement", value: (r) => r.movementNo },
        { header: "Employee ID", value: (r) => r.person.employeeId },
        { header: "Employee", value: (r) => r.person.name, width: 24 },
        { header: "Event", value: (r) => r.event, width: 24 },
        { header: "By", value: (r) => r.by, width: 22 },
        { header: "When", value: (r) => (r.at ? fmtDateTime(r.at) : "") },
        { header: "Original (out → in)", value: (r) => r.original, width: 34 },
        { header: "Recorded / proposed (out → in)", value: (r) => r.proposed, width: 34 },
        { header: "Outcome", value: (r) => r.outcome, width: 34 },
        { header: "Reason / note", value: (r) => r.note, width: 40 },
      ],
      rows,
      summary: [
        { label: "Correction requests", value: String(count("Correction request")) },
        { label: "Approval decisions", value: String(count("Approval decision")) },
        { label: "Alternative entries", value: String(count("Alternative entry")) },
        { label: "Manual resolutions", value: String(count("Resolved by authorised user")) },
      ],
      note: showPersonal ? undefined : "Reasons and notes on personal movements are hidden.",
    };
  },
});

function titleCaseStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export const movementReports = [
  movementDaily,
  movementHistory,
  movementTimes,
  movementDuration,
  movementOverdue,
  movementOfficial,
  movementPersonal,
  movementPending,
  movementAudit,
];

// Used by the reports landing page to chart time outside the office by department.
export interface DepartmentMovementTotals {
  department: string;
  officialMinutes: number;
  personalMinutes: number;
}

export async function movementMinutesByDepartment(from: string, to: string): Promise<{ rows: DepartmentMovementTotals[]; movements: number; overdue: number }> {
  await connectDB();
  const settings = await getSettings();
  const docs = await Movement.find({ date: { $gte: from, $lte: to }, status: { $in: ["out", "returned"] } }, { user: 1, official: 1, durationMinutes: 1, status: 1, expectedReturn: 1, inTime: 1 }).lean();
  const people = await peopleMap(docs.map((d) => d.user));
  const map = new Map<string, DepartmentMovementTotals>();
  let overdue = 0;
  for (const d of docs) {
    const dept = people.get(d.user.toString())?.department || "No department";
    const row = map.get(dept) ?? { department: dept, officialMinutes: 0, personalMinutes: 0 };
    if (d.official) row.officialMinutes += d.durationMinutes ?? 0;
    else row.personalMinutes += d.durationMinutes ?? 0;
    map.set(dept, row);
    if (lateBy(d, settings) > 0) overdue += 1;
  }
  const rows = [...map.values()].sort((a, b) => b.officialMinutes + b.personalMinutes - (a.officialMinutes + a.personalMinutes));
  return { rows, movements: docs.length, overdue };
}
