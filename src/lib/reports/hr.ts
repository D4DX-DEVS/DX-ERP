import "server-only";
import { connectDB } from "@/lib/db";
import {
  Attendance,
  AttendanceCorrection,
  LeaveBalance,
  LeaveRequest,
  LeaveType,
  PayrollRun,
  Payslip,
  PERSON_TYPES,
  Review,
  StoredFile,
  Task,
  User,
} from "@/lib/models";
import type { ExportColumn } from "@/lib/export";
import { accruedFor, leaveYearOf, leaveYearRange } from "@/lib/domain/leave-balance";
import { getSettings } from "@/lib/settings";
import { statusLabel } from "@/lib/status";
import { addDays, diffDays, eachDay, fmtDate, fmtDateTime, fmtTime, monthRange, todayKey } from "@/lib/time";
import { inr, plural, round2, titleCase } from "@/lib/format";
import { EXITED_STATUSES } from "@/lib/people";
import {
  DEFAULTS,
  DEPARTMENT_FILTER,
  hoursOf,
  instantRange,
  loadAttendance,
  loadStaff,
  monthRangeOf,
  PERSON_FILTER,
  peopleMap,
  rangeOf,
  RANGE_FILTERS,
  userScope,
  yesNo,
  type PersonInfo,
} from "./shared";
import { defineReport, type ReportFilterDef } from "./types";

const HR = ["reports.view", "reports.hr"] as const;
const FINANCE_PAYROLL = ["reports.view", "reports.financial", "payroll.view"] as const;

const personCols = <R extends { person: PersonInfo }>(): ExportColumn<R>[] => [
  { header: "Employee ID", value: (r) => r.person.employeeId },
  { header: "Employee", value: (r) => r.person.name, width: 24 },
  { header: "Department", value: (r) => r.person.department, width: 20 },
];

const MONTH_FILTER: ReportFilterDef = { key: "month", label: "Month", type: "month", defaultValue: DEFAULTS.thisMonth };

/* ------------------------------------------------------------ employee directory */

interface DirectoryRow {
  employeeId: string;
  name: string;
  type: string;
  department: string;
  designation: string;
  employmentType: string;
  status: string;
  joiningDate: string;
  manager: string;
  email: string;
  phone: string;
}

const employeeDirectory = defineReport<DirectoryRow>({
  key: "employee-directory",
  title: "Employee directory & status",
  group: "HR",
  description: "Everyone on the books with department, designation, employment type and status.",
  permissions: [...HR],
  filters: [
    DEPARTMENT_FILTER,
    { key: "type", label: "Person type", type: "select", options: PERSON_TYPES.map((t) => ({ value: t, label: titleCase(t) })) },
    { key: "status", label: "Status", type: "select", optionsFrom: "employmentStatuses" },
  ],
  async run(f) {
    await connectDB();
    const settings = await getSettings();
    const filter: Record<string, unknown> = { personType: f.type ? f.type : { $in: PERSON_TYPES } };
    if (f.department) filter.department = f.department;
    if (f.status) filter.status = f.status;
    const users = await User.find(filter, {
      employeeId: 1,
      name: 1,
      personType: 1,
      department: 1,
      designation: 1,
      employmentType: 1,
      status: 1,
      joiningDate: 1,
      reportingManager: 1,
      email: 1,
      phone: 1,
    })
      .sort({ name: 1 })
      .lean();
    const people = await peopleMap([...users.map((u) => u._id), ...users.map((u) => u.reportingManager)]);
    const rows: DirectoryRow[] = users.map((u) => {
      const p = people.get(u._id.toString());
      return {
        employeeId: u.employeeId,
        name: u.name,
        type: titleCase(u.personType),
        department: p?.department ?? "",
        designation: p?.designation ?? "",
        employmentType: titleCase(u.employmentType),
        status: settings.employmentStatuses.find((s) => s.key === u.status)?.label ?? titleCase(u.status),
        joiningDate: fmtDate(u.joiningDate),
        manager: u.reportingManager ? (people.get(u.reportingManager.toString())?.name ?? "") : "",
        email: u.email,
        phone: u.phone ?? "",
      };
    });
    const active = users.filter((u) => !EXITED_STATUSES.includes(u.status)).length;
    return {
      columns: [
        { header: "Employee ID", value: (r) => r.employeeId },
        { header: "Name", value: (r) => r.name, width: 24 },
        { header: "Type", value: (r) => r.type },
        { header: "Department", value: (r) => r.department, width: 20 },
        { header: "Designation", value: (r) => r.designation, width: 22 },
        { header: "Employment", value: (r) => r.employmentType },
        { header: "Status", value: (r) => r.status },
        { header: "Joined", value: (r) => r.joiningDate },
        { header: "Reporting manager", value: (r) => r.manager, width: 22 },
        { header: "Email", value: (r) => r.email, width: 28 },
        { header: "Phone", value: (r) => r.phone },
      ],
      rows,
      summary: [
        { label: "People", value: String(rows.length) },
        { label: "Active", value: String(active) },
        { label: "Employees", value: String(users.filter((u) => u.personType === "employee").length) },
        { label: "Trainees & interns", value: String(users.filter((u) => u.personType !== "employee").length) },
      ],
    };
  },
});

/* --------------------------------------------------------------- daily attendance */

interface DailyRow {
  person: PersonInfo;
  status: string;
  checkIn: string;
  checkOut: string;
  breakMinutes?: number;
  workHours?: number;
  late: string;
  early: string;
  source: string;
  remarks: string;
}

const attendanceDaily = defineReport<DailyRow>({
  key: "attendance-daily",
  title: "Daily attendance",
  group: "HR",
  description: "Check-in, check-out and status of every person for one day, including leave and absences.",
  permissions: [...HR],
  filters: [{ key: "date", label: "Date", type: "date", defaultValue: DEFAULTS.today }, DEPARTMENT_FILTER, PERSON_FILTER],
  async run(f) {
    const date = f.date || todayKey();
    const today = todayKey();
    const everyone = await loadStaff(f);
    const staff = everyone.filter((p) => !p.joiningDate || p.joiningDate <= date);
    const ctx = await loadAttendance(staff.map((p) => p.id), date, date);
    const rows: DailyRow[] = [];
    for (const person of staff) {
      const doc = ctx.attendanceOf(person.id, date);
      if (!doc && EXITED_STATUSES.includes(person.status)) continue;
      const leave = ctx.leaveOn(person.id, date);
      let status: string;
      if (doc) status = statusLabel("attendance", doc.missingCheckout ? "missing_checkout" : doc.status);
      else if (leave === "full") status = "On leave";
      else if (ctx.cal.isHoliday(date)) status = "Holiday";
      else if (ctx.cal.isWeekend(date)) status = "Weekend";
      else status = date < today ? "Absent" : date === today ? "Not checked in" : "Upcoming";
      rows.push({
        person,
        status: leave === "half" && doc ? `${status} (half-day leave)` : status,
        checkIn: fmtTime(doc?.checkIn),
        checkOut: fmtTime(doc?.checkOut),
        breakMinutes: doc ? doc.breakMinutes : undefined,
        workHours: doc?.checkOut ? hoursOf(doc.workMinutes) : undefined,
        late: doc?.late ? `${doc.lateMinutes} min` : "",
        early: doc?.earlyDeparture ? `${doc.earlyMinutes} min` : "",
        source: doc ? titleCase(doc.source) : "",
        remarks: doc?.remarks ?? "",
      });
    }
    const count = (s: string) => rows.filter((r) => r.status.startsWith(s)).length;
    return {
      columns: [
        ...personCols<DailyRow>(),
        { header: "Status", value: (r) => r.status },
        { header: "Check-in", value: (r) => r.checkIn },
        { header: "Check-out", value: (r) => r.checkOut },
        { header: "Breaks (min)", value: (r) => r.breakMinutes, type: "number" },
        { header: "Work hours", value: (r) => r.workHours, type: "number" },
        { header: "Late by", value: (r) => r.late },
        { header: "Left early by", value: (r) => r.early },
        { header: "Source", value: (r) => r.source },
        { header: "Remarks", value: (r) => r.remarks, width: 28 },
      ],
      rows,
      summary: [
        { label: "Present", value: String(rows.filter((r) => r.status.startsWith("Present") || r.status.startsWith("Half") || r.status.startsWith("Missing")).length) },
        { label: "Late", value: String(rows.filter((r) => r.late).length) },
        { label: "Absent", value: String(count("Absent")) },
        { label: "On leave", value: String(count("On leave")) },
        { label: "Not checked in", value: String(count("Not checked in")) },
      ],
      note: `Attendance for ${fmtDate(date)}.`,
    };
  },
});

/* ------------------------------------------------------------ monthly attendance */

interface MonthlyRow {
  person: PersonInfo;
  workingDays: number;
  present: number;
  halfDays: number;
  leaveDays: number;
  absent: number;
  late: number;
  early: number;
  missingCheckout: number;
  hours: number;
  avgHours?: number;
  rate?: number;
}

const attendanceMonthly = defineReport<MonthlyRow>({
  key: "attendance-monthly",
  title: "Monthly attendance summary",
  group: "HR",
  description: "Per-person present, half-day, leave and absent days with late arrivals and hours for a month.",
  permissions: [...HR],
  filters: [MONTH_FILTER, DEPARTMENT_FILTER, PERSON_FILTER],
  async run(f) {
    const { from, to: monthEnd } = monthRange(f.month || DEFAULTS.thisMonth());
    const today = todayKey();
    const to = monthEnd < today ? monthEnd : today;
    const staff = await loadStaff(f);
    const ctx = await loadAttendance(staff.map((p) => p.id), from, monthEnd);
    const days = from > to ? [] : eachDay(from, to);
    const rows: MonthlyRow[] = [];
    for (const person of staff) {
      const start = person.joiningDate && person.joiningDate > from ? person.joiningDate : from;
      const row: MonthlyRow = { person, workingDays: 0, present: 0, halfDays: 0, leaveDays: 0, absent: 0, late: 0, early: 0, missingCheckout: 0, hours: 0 };
      let attended = 0;
      let minutes = 0;
      for (const day of days) {
        if (day < start) continue;
        const doc = ctx.attendanceOf(person.id, day);
        const working = ctx.cal.isWorkingDay(day);
        if (working) row.workingDays += 1;
        if (doc) {
          if (doc.status === "present") row.present += 1;
          else if (doc.status === "half_day") row.halfDays += 1;
          else if (doc.status === "on_leave") row.leaveDays += 1;
          else if (doc.status === "absent" && working) row.absent += 1;
          if (doc.late) row.late += 1;
          if (doc.earlyDeparture) row.early += 1;
          if (doc.missingCheckout) row.missingCheckout += 1;
          if (doc.checkIn) attended += 1;
          minutes += doc.workMinutes;
        } else if (working) {
          const leave = ctx.leaveOn(person.id, day);
          if (leave === "full") row.leaveDays += 1;
          else if (leave === "half") {
            row.leaveDays += 0.5;
            row.absent += 0.5;
          } else if (day < today) row.absent += 1;
        }
      }
      row.hours = hoursOf(minutes);
      row.avgHours = attended ? round2(row.hours / attended) : undefined;
      const due = row.workingDays - row.leaveDays;
      row.rate = due > 0 ? Math.round(((row.present + row.halfDays * 0.5) / due) * 100) : undefined;
      rows.push(row);
    }
    const sum = (pick: (r: MonthlyRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
    return {
      columns: [
        ...personCols<MonthlyRow>(),
        { header: "Working days", value: (r) => r.workingDays, type: "number" },
        { header: "Present", value: (r) => r.present, type: "number" },
        { header: "Half days", value: (r) => r.halfDays, type: "number" },
        { header: "On leave", value: (r) => r.leaveDays, type: "number" },
        { header: "Absent", value: (r) => r.absent, type: "number" },
        { header: "Late arrivals", value: (r) => r.late, type: "number" },
        { header: "Early departures", value: (r) => r.early, type: "number" },
        { header: "Missing check-outs", value: (r) => r.missingCheckout, type: "number" },
        { header: "Total hours", value: (r) => r.hours, type: "number" },
        { header: "Avg hours / day", value: (r) => r.avgHours, type: "number" },
        { header: "Attendance %", value: (r) => r.rate, type: "number" },
      ],
      rows,
      summary: [
        { label: "People", value: String(rows.length) },
        { label: "Present days", value: String(sum((r) => r.present)) },
        { label: "Absent days", value: String(sum((r) => r.absent)) },
        { label: "Late arrivals", value: String(sum((r) => r.late)) },
        { label: "Hours worked", value: String(round2(sum((r) => r.hours))) },
      ],
      note: "Absences are counted for working days up to today; approved leave and holidays are excluded.",
    };
  },
});

/* ------------------------------------------------------------ late & early */

interface LateRow {
  person: PersonInfo;
  date: string;
  checkIn: string;
  lateMinutes: number;
  checkOut: string;
  earlyMinutes: number;
  workHours?: number;
  remarks: string;
}

const attendanceLateEarly = defineReport<LateRow>({
  key: "attendance-late-early",
  title: "Late arrival & early departure",
  group: "HR",
  description: "Days on which someone checked in after the grace period or left before closing time.",
  permissions: [...HR],
  filters: [
    ...RANGE_FILTERS,
    {
      key: "kind",
      label: "Show",
      type: "select",
      options: [
        { value: "late", label: "Late arrivals" },
        { value: "early", label: "Early departures" },
      ],
    },
    DEPARTMENT_FILTER,
    PERSON_FILTER,
  ],
  async run(f) {
    await connectDB();
    const { from, to } = rangeOf(f);
    const flags = f.kind === "late" ? [{ late: true }] : f.kind === "early" ? [{ earlyDeparture: true }] : [{ late: true }, { earlyDeparture: true }];
    const docs = await Attendance.find(
      { date: { $gte: from, $lte: to }, ...(await userScope(f)), $or: flags },
      { user: 1, date: 1, checkIn: 1, checkOut: 1, late: 1, lateMinutes: 1, earlyDeparture: 1, earlyMinutes: 1, workMinutes: 1, remarks: 1 },
    )
      .sort({ date: -1 })
      .limit(20_000)
      .lean();
    const people = await peopleMap(docs.map((d) => d.user));
    const rows: LateRow[] = docs.flatMap((d) => {
      const person = people.get(d.user.toString());
      if (!person) return [];
      return [
        {
          person,
          date: d.date,
          checkIn: fmtTime(d.checkIn),
          lateMinutes: d.late ? d.lateMinutes : 0,
          checkOut: fmtTime(d.checkOut),
          earlyMinutes: d.earlyDeparture ? d.earlyMinutes : 0,
          workHours: d.checkOut ? hoursOf(d.workMinutes) : undefined,
          remarks: d.remarks ?? "",
        },
      ];
    });
    const lateRows = rows.filter((r) => r.lateMinutes > 0);
    return {
      columns: [
        { header: "Date", value: (r) => fmtDate(r.date) },
        ...personCols<LateRow>(),
        { header: "Check-in", value: (r) => r.checkIn },
        { header: "Late by (min)", value: (r) => r.lateMinutes || null, type: "number" },
        { header: "Check-out", value: (r) => r.checkOut },
        { header: "Left early by (min)", value: (r) => r.earlyMinutes || null, type: "number" },
        { header: "Work hours", value: (r) => r.workHours, type: "number" },
        { header: "Remarks", value: (r) => r.remarks, width: 28 },
      ],
      rows,
      summary: [
        { label: "Late arrivals", value: String(lateRows.length) },
        { label: "Early departures", value: String(rows.filter((r) => r.earlyMinutes > 0).length) },
        { label: "Avg minutes late", value: lateRows.length ? String(Math.round(lateRows.reduce((s, r) => s + r.lateMinutes, 0) / lateRows.length)) : "0" },
        { label: "People affected", value: String(new Set(rows.map((r) => r.person.id)).size) },
      ],
    };
  },
});

/* ---------------------------------------------------------- missing attendance */

interface MissingRow {
  person: PersonInfo;
  date: string;
  issue: string;
  detail: string;
}

const attendanceMissing = defineReport<MissingRow>({
  key: "attendance-missing",
  title: "Missing attendance",
  group: "HR",
  description: "Working days with no attendance record (absent without approved leave) and records with no check-out.",
  permissions: [...HR],
  filters: [
    ...RANGE_FILTERS,
    {
      key: "issue",
      label: "Issue",
      type: "select",
      options: [
        { value: "absent", label: "No attendance record" },
        { value: "checkout", label: "Missing check-out" },
      ],
    },
    DEPARTMENT_FILTER,
    PERSON_FILTER,
  ],
  async run(f) {
    const { from, to: end } = rangeOf(f);
    const today = todayKey();
    // A day can only be "absent" once it is over; open check-outs are reported for any day in range.
    const lastAbsenceDay = end < today ? end : addDays(today, -1);
    const trackingStart = (await getSettings()).attendance.trackingStartDate;
    const staff = await loadStaff(f);
    const ctx = await loadAttendance(staff.map((p) => p.id), from, end);
    const rows: MissingRow[] = [];
    for (const person of staff) {
      const start = person.joiningDate && person.joiningDate > from ? person.joiningDate : from;
      for (const day of start > end ? [] : eachDay(start, end)) {
        const doc = ctx.attendanceOf(person.id, day);
        if (doc?.checkIn && !doc.checkOut) {
          if (f.issue !== "absent" && (doc.missingCheckout || day < today)) {
            rows.push({ person, date: day, issue: "Missing check-out", detail: `Checked in at ${fmtTime(doc.checkIn)}, no check-out recorded` });
          }
          continue;
        }
        if (f.issue === "checkout" || doc || day > lastAbsenceDay || !ctx.cal.isWorkingDay(day)) continue;
        if (trackingStart && day < trackingStart) continue;
        const leave = ctx.leaveOn(person.id, day);
        if (leave === "full") continue;
        rows.push({
          person,
          date: day,
          issue: "No attendance record",
          detail: leave === "half" ? "Half-day leave approved; no attendance for the rest of the day" : "Working day with no check-in and no approved leave",
        });
      }
    }
    rows.sort((a, b) => (a.date === b.date ? a.person.name.localeCompare(b.person.name) : b.date.localeCompare(a.date)));
    return {
      columns: [{ header: "Date", value: (r) => fmtDate(r.date) }, ...personCols<MissingRow>(), { header: "Issue", value: (r) => r.issue, width: 22 }, { header: "Detail", value: (r) => r.detail, width: 44 }],
      rows,
      summary: [
        { label: "No record", value: String(rows.filter((r) => r.issue === "No attendance record").length) },
        { label: "Missing check-out", value: String(rows.filter((r) => r.issue === "Missing check-out").length) },
        { label: "People affected", value: String(new Set(rows.map((r) => r.person.id)).size) },
      ],
    };
  },
});

/* -------------------------------------------------------------- working hours */

interface HoursRow {
  person: PersonInfo;
  attendedDays: number;
  totalHours: number;
  avgHours?: number;
  expectedHours: number;
  varianceHours: number;
  utilisation?: number;
  breakHours: number;
  movementHours: number;
}

const workingHours = defineReport<HoursRow>({
  key: "working-hours",
  title: "Working-hour summary",
  group: "HR",
  description: "Hours worked against the expected hours for the period, with break and movement time.",
  permissions: [...HR],
  filters: [...RANGE_FILTERS, DEPARTMENT_FILTER, PERSON_FILTER],
  async run(f) {
    const { from, to: end } = rangeOf(f);
    const today = todayKey();
    const to = end < today ? end : today;
    const staff = await loadStaff(f);
    const ctx = await loadAttendance(staff.map((p) => p.id), from, end);
    const fullDay = ctx.settings.attendance.fullDayMinutes;
    const rows: HoursRow[] = staff.map((person) => {
      const start = person.joiningDate && person.joiningDate > from ? person.joiningDate : from;
      let attended = 0;
      let work = 0;
      let breaks = 0;
      let movement = 0;
      let expected = 0;
      for (const day of start > to ? [] : eachDay(start, to)) {
        const doc = ctx.attendanceOf(person.id, day);
        if (doc?.checkIn) attended += 1;
        if (doc) {
          work += doc.workMinutes;
          breaks += doc.breakMinutes;
          movement += doc.movementMinutes;
        }
        // Today only counts once the person has finished the day, so a half-worked day is not a shortfall.
        if (ctx.cal.isWorkingDay(day) && (day < today || doc?.checkOut)) {
          const leave = ctx.leaveOn(person.id, day);
          expected += leave === "full" ? 0 : leave === "half" ? fullDay / 2 : fullDay;
        }
      }
      return {
        person,
        attendedDays: attended,
        totalHours: hoursOf(work),
        avgHours: attended ? round2(hoursOf(work) / attended) : undefined,
        expectedHours: hoursOf(expected),
        varianceHours: round2(hoursOf(work) - hoursOf(expected)),
        utilisation: expected ? Math.round((work / expected) * 100) : undefined,
        breakHours: hoursOf(breaks),
        movementHours: hoursOf(movement),
      };
    });
    const total = rows.reduce((s, r) => s + r.totalHours, 0);
    const expected = rows.reduce((s, r) => s + r.expectedHours, 0);
    return {
      columns: [
        ...personCols<HoursRow>(),
        { header: "Days attended", value: (r) => r.attendedDays, type: "number" },
        { header: "Hours worked", value: (r) => r.totalHours, type: "number" },
        { header: "Avg hours / day", value: (r) => r.avgHours, type: "number" },
        { header: "Expected hours", value: (r) => r.expectedHours, type: "number" },
        { header: "Variance (h)", value: (r) => r.varianceHours, type: "number" },
        { header: "Utilisation %", value: (r) => r.utilisation, type: "number" },
        { header: "Break hours", value: (r) => r.breakHours, type: "number" },
        { header: "Movement hours", value: (r) => r.movementHours, type: "number" },
      ],
      rows,
      summary: [
        { label: "People", value: String(rows.length) },
        { label: "Hours worked", value: String(round2(total)) },
        { label: "Expected hours", value: String(round2(expected)) },
        { label: "Utilisation", value: expected ? `${Math.round((total / expected) * 100)}%` : "—" },
      ],
      note: "Expected hours = working days (excluding holidays and approved leave) × the configured full-day minutes.",
    };
  },
});

/* ------------------------------------------------------- correction history */

interface CorrectionRow {
  person: PersonInfo;
  requestedOn: string;
  date: string;
  original: string;
  requested: string;
  reason: string;
  status: string;
  reviewer: string;
  reviewedOn: string;
  note: string;
}

const attendanceCorrections = defineReport<CorrectionRow>({
  key: "attendance-corrections",
  title: "Attendance correction history",
  group: "HR",
  description: "Correction requests with original and requested times, reasons and approval outcome.",
  permissions: [...HR],
  filters: [
    ...RANGE_FILTERS,
    {
      key: "status",
      label: "Status",
      type: "select",
      options: ["pending", "approved", "rejected", "cancelled"].map((s) => ({ value: s, label: statusLabel("correction", s) })),
    },
    DEPARTMENT_FILTER,
    PERSON_FILTER,
  ],
  async run(f) {
    await connectDB();
    const { from, to } = rangeOf(f);
    const { start, end } = instantRange(from, to);
    const filter: Record<string, unknown> = { createdAt: { $gte: start, $lte: end }, ...(await userScope(f)) };
    if (f.status) filter.status = f.status;
    const docs = await AttendanceCorrection.find(filter).sort({ createdAt: -1 }).limit(20_000).lean();
    const people = await peopleMap(docs.map((d) => d.user));
    const range = (a?: Date, b?: Date) => `${fmtTime(a)} – ${fmtTime(b)}`;
    const rows: CorrectionRow[] = docs.flatMap((d) => {
      const person = people.get(d.user.toString());
      if (!person) return [];
      return [
        {
          person,
          requestedOn: fmtDateTime(d.createdAt),
          date: d.date,
          original: range(d.original?.checkIn, d.original?.checkOut),
          requested: range(d.requestedCheckIn, d.requestedCheckOut),
          reason: d.reason,
          status: statusLabel("correction", d.status),
          reviewer: d.reviewerName ?? "",
          reviewedOn: d.reviewedAt ? fmtDateTime(d.reviewedAt) : "",
          note: d.reviewNote ?? "",
        },
      ];
    });
    const count = (s: string) => rows.filter((r) => r.status === statusLabel("correction", s)).length;
    return {
      columns: [
        { header: "Requested on", value: (r) => r.requestedOn },
        { header: "Attendance date", value: (r) => fmtDate(r.date) },
        ...personCols<CorrectionRow>(),
        { header: "Original (in – out)", value: (r) => r.original },
        { header: "Requested (in – out)", value: (r) => r.requested },
        { header: "Reason", value: (r) => r.reason, width: 36 },
        { header: "Status", value: (r) => r.status },
        { header: "Reviewed by", value: (r) => r.reviewer },
        { header: "Reviewed on", value: (r) => r.reviewedOn },
        { header: "Review note", value: (r) => r.note, width: 30 },
      ],
      rows,
      summary: [
        { label: "Requests", value: String(rows.length) },
        { label: "Approved", value: String(count("approved")) },
        { label: "Rejected", value: String(count("rejected")) },
        { label: "Pending", value: String(count("pending")) },
      ],
    };
  },
});

/* ------------------------------------------------------------ leave balances */

interface LeaveBalanceReportRow {
  person: PersonInfo;
  leaveType: string;
  quota: number;
  accrued: number;
  carried: number;
  adjustment: number;
  used: number;
  pending: number;
  available: number | null;
}

const leaveUsage = defineReport<LeaveBalanceReportRow>({
  key: "leave-usage",
  title: "Leave usage & balances",
  group: "HR",
  description: "Quota, accrual, carry-forward, leave taken and remaining balance per person and leave type for a leave year.",
  permissions: [...HR],
  filters: [{ key: "year", label: "Leave year", type: "select", optionsFrom: "leaveYears" }, DEPARTMENT_FILTER, PERSON_FILTER],
  async run(f) {
    await connectDB();
    const settings = await getSettings();
    const today = todayKey();
    const year = Number(f.year) || leaveYearOf(today, settings);
    const { from, to } = leaveYearRange(year, settings);
    const staff = await loadStaff(f);
    const ids = staff.map((p) => p.id);
    const [types, balances, requests] = await Promise.all([
      LeaveType.find({ active: true }).sort({ order: 1, name: 1 }).lean(),
      LeaveBalance.find({ user: { $in: ids }, year }).lean(),
      LeaveRequest.find(
        { user: { $in: ids }, status: { $in: ["approved", "pending_manager", "pending_hr"] }, startDate: { $lte: to }, endDate: { $gte: from } },
        { user: 1, leaveType: 1, days: 1, status: 1 },
      ).lean(),
    ]);
    const balanceOf = new Map(balances.map((b) => [`${b.user.toString()}|${b.leaveType.toString()}`, b]));
    const usage = new Map<string, { used: number; pending: number }>();
    for (const r of requests) {
      const key = `${r.user.toString()}|${r.leaveType.toString()}`;
      const cur = usage.get(key) ?? { used: 0, pending: 0 };
      if (r.status === "approved") cur.used += r.days;
      else cur.pending += r.days;
      usage.set(key, cur);
    }
    const rows: LeaveBalanceReportRow[] = [];
    for (const person of staff) {
      for (const t of types) {
        if (!t.applicableTo.includes(person.personType)) continue;
        const key = `${person.id}|${t._id.toString()}`;
        const b = balanceOf.get(key);
        const u = usage.get(key) ?? { used: 0, pending: 0 };
        const quota = b?.quotaOverride ?? t.annualQuota;
        const accrued = accruedFor(t, quota, year, today, settings);
        const carried = b?.carriedForward ?? 0;
        const adjustment = b?.adjustment ?? 0;
        rows.push({
          person,
          leaveType: t.name,
          quota,
          accrued,
          carried,
          adjustment,
          used: u.used,
          pending: u.pending,
          available: t.paid ? Math.round((accrued + carried + adjustment - u.used - u.pending) * 2) / 2 : null,
        });
      }
    }
    return {
      columns: [
        ...personCols<LeaveBalanceReportRow>(),
        { header: "Leave type", value: (r) => r.leaveType },
        { header: "Annual quota", value: (r) => r.quota, type: "number" },
        { header: "Accrued to date", value: (r) => r.accrued, type: "number" },
        { header: "Carried forward", value: (r) => r.carried, type: "number" },
        { header: "Adjustment", value: (r) => r.adjustment, type: "number" },
        { header: "Used", value: (r) => r.used, type: "number" },
        { header: "Pending approval", value: (r) => r.pending, type: "number" },
        { header: "Available", value: (r) => r.available, type: "number" },
      ],
      rows,
      summary: [
        { label: "Leave year", value: `${fmtDate(from)} – ${fmtDate(to)}` },
        { label: "Days used", value: String(rows.reduce((s, r) => s + r.used, 0)) },
        { label: "Days pending", value: String(rows.reduce((s, r) => s + r.pending, 0)) },
      ],
      note: "Unpaid leave types have no balance limit, so “Available” is left blank for them.",
    };
  },
});

/* ------------------------------------------------------------ leave by employee */

interface LeaveRow {
  person: PersonInfo;
  requestNo: string;
  type: string;
  startDate: string;
  endDate: string;
  days: number;
  halfDay: boolean;
  status: string;
  reason: string;
  appliedOn: string;
  decidedBy: string;
  note: string;
}

const leaveByEmployee = defineReport<LeaveRow>({
  key: "leave-by-employee",
  title: "Leave by employee & date range",
  group: "HR",
  description: "Every leave request overlapping the period with dates, days, status and who decided it.",
  permissions: [...HR],
  filters: [
    ...RANGE_FILTERS,
    { key: "status", label: "Status", type: "select", options: ["pending_manager", "pending_hr", "approved", "rejected", "cancelled"].map((s) => ({ value: s, label: statusLabel("leave", s) })) },
    { key: "leaveType", label: "Leave type", type: "select", optionsFrom: "leaveTypes" },
    DEPARTMENT_FILTER,
    PERSON_FILTER,
  ],
  async run(f) {
    await connectDB();
    const { from, to } = rangeOf(f);
    const filter: Record<string, unknown> = { startDate: { $lte: to }, endDate: { $gte: from }, ...(await userScope(f)) };
    if (f.status) filter.status = f.status;
    if (/^[a-f0-9]{24}$/i.test(f.leaveType ?? "")) filter.leaveType = f.leaveType;
    const docs = await LeaveRequest.find(filter).sort({ startDate: -1 }).limit(20_000).lean();
    const people = await peopleMap(docs.map((d) => d.user));
    const rows: LeaveRow[] = docs.flatMap((d) => {
      const person = people.get(d.user.toString());
      if (!person) return [];
      const last = d.approvals[d.approvals.length - 1];
      return [
        {
          person,
          requestNo: d.requestNo,
          type: d.leaveTypeName ?? "",
          startDate: d.startDate,
          endDate: d.endDate,
          days: d.days,
          halfDay: d.halfDay,
          status: statusLabel("leave", d.status),
          reason: d.reason,
          appliedOn: fmtDate(d.createdAt),
          decidedBy: last?.byName ?? "",
          note: last?.note ?? "",
        },
      ];
    });
    const days = (status?: string) => rows.filter((r) => !status || r.status === statusLabel("leave", status)).reduce((s, r) => s + r.days, 0);
    return {
      columns: [
        { header: "Request", value: (r) => r.requestNo },
        ...personCols<LeaveRow>(),
        { header: "Leave type", value: (r) => r.type },
        { header: "From", value: (r) => fmtDate(r.startDate) },
        { header: "To", value: (r) => fmtDate(r.endDate) },
        { header: "Days", value: (r) => r.days, type: "number" },
        { header: "Half day", value: (r) => yesNo(r.halfDay) },
        { header: "Status", value: (r) => r.status },
        { header: "Reason", value: (r) => r.reason, width: 34 },
        { header: "Applied on", value: (r) => r.appliedOn },
        { header: "Last decision by", value: (r) => r.decidedBy },
        { header: "Decision note", value: (r) => r.note, width: 28 },
      ],
      rows,
      summary: [
        { label: "Requests", value: String(rows.length) },
        { label: "Days requested", value: String(days()) },
        { label: "Days approved", value: String(days("approved")) },
        { label: "People", value: String(new Set(rows.map((r) => r.person.id)).size) },
      ],
    };
  },
});

/* ----------------------------------------------------------- payroll summaries */

interface RunRow {
  period: string;
  runNo: string;
  kind: string;
  status: string;
  people: number;
  workingDays: number;
  gross: number;
  deductions: number;
  net: number;
  verifiedBy: string;
  approvedBy: string;
  paidOn: string;
}

const payrollSummary = defineReport<RunRow>({
  key: "payroll-summary",
  title: "Payroll & stipend run summary",
  group: "HR",
  description: "Gross, deductions and net per payroll or stipend run, with approval and payment status.",
  permissions: [...FINANCE_PAYROLL],
  filters: [
    { key: "from", label: "From month", type: "month", defaultValue: DEFAULTS.sixMonthsAgo },
    { key: "to", label: "To month", type: "month", defaultValue: DEFAULTS.thisMonth },
    {
      key: "kind",
      label: "Kind",
      type: "select",
      options: [
        { value: "salary", label: "Salary" },
        { value: "stipend", label: "Stipend" },
      ],
    },
  ],
  async run(f) {
    await connectDB();
    const { from, to } = monthRangeOf(f);
    const filter: Record<string, unknown> = { period: { $gte: from, $lte: to }, status: { $ne: "cancelled" } };
    if (f.kind) filter.kind = f.kind;
    const runs = await PayrollRun.find(filter).sort({ period: -1, kind: 1 }).lean();
    const rows: RunRow[] = runs.map((r) => ({
      period: r.period,
      runNo: r.runNo,
      kind: titleCase(r.kind),
      status: statusLabel("payrollRun", r.status),
      people: r.totals.count,
      workingDays: r.workingDays,
      gross: r.totals.gross,
      deductions: r.totals.deductions,
      net: r.totals.net,
      verifiedBy: r.verifiedByName ?? "",
      approvedBy: r.approvedByName ?? "",
      paidOn: fmtDate(r.paidAt),
    }));
    const sum = (pick: (r: RunRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
    return {
      columns: [
        { header: "Period", value: (r) => r.period },
        { header: "Run", value: (r) => r.runNo },
        { header: "Kind", value: (r) => r.kind },
        { header: "Status", value: (r) => r.status },
        { header: "People", value: (r) => r.people, type: "number" },
        { header: "Working days", value: (r) => r.workingDays, type: "number" },
        { header: "Gross", value: (r) => r.gross, type: "money" },
        { header: "Deductions", value: (r) => r.deductions, type: "money" },
        { header: "Net payable", value: (r) => r.net, type: "money" },
        { header: "Verified by", value: (r) => r.verifiedBy },
        { header: "Approved by", value: (r) => r.approvedBy },
        { header: "Paid on", value: (r) => r.paidOn },
      ],
      rows,
      summary: [
        { label: "Runs", value: String(rows.length) },
        { label: "Gross", value: inr(sum((r) => r.gross)) },
        { label: "Deductions", value: inr(sum((r) => r.deductions)) },
        { label: "Net payable", value: inr(sum((r) => r.net)) },
      ],
      note: "Cancelled runs are excluded.",
    };
  },
});

interface StipendRow {
  person: PersonInfo;
  period: string;
  payableDays: number;
  lopDays: number;
  gross: number;
  deductions: number;
  net: number;
  status: string;
  paidOn: string;
  reference: string;
}

const stipendSummary = defineReport<StipendRow>({
  key: "stipend-summary",
  title: "Stipend summary",
  group: "HR",
  description: "Stipend statements per intern and trainee with payable days, amount and payment status.",
  permissions: [...FINANCE_PAYROLL],
  filters: [
    { key: "from", label: "From month", type: "month", defaultValue: DEFAULTS.sixMonthsAgo },
    { key: "to", label: "To month", type: "month", defaultValue: DEFAULTS.thisMonth },
    { key: "status", label: "Status", type: "select", options: ["draft", "approved", "paid", "on_hold"].map((s) => ({ value: s, label: statusLabel("payslip", s) })) },
    DEPARTMENT_FILTER,
    PERSON_FILTER,
  ],
  async run(f) {
    await connectDB();
    const { from, to } = monthRangeOf(f);
    const filter: Record<string, unknown> = { kind: "stipend", period: { $gte: from, $lte: to }, ...(await userScope(f)) };
    if (f.status) filter.status = f.status;
    const slips = await Payslip.find(filter, { user: 1, period: 1, payableDays: 1, lopDays: 1, gross: 1, totalDeductions: 1, net: 1, status: 1, payment: 1 }).sort({ period: -1 }).limit(20_000).lean();
    const people = await peopleMap(slips.map((s) => s.user));
    const rows: StipendRow[] = slips.flatMap((s) => {
      const person = people.get(s.user.toString());
      if (!person) return [];
      return [
        {
          person,
          period: s.period,
          payableDays: s.payableDays,
          lopDays: s.lopDays,
          gross: s.gross,
          deductions: s.totalDeductions,
          net: s.net,
          status: statusLabel("payslip", s.status),
          paidOn: fmtDate(s.payment?.date),
          reference: s.payment?.reference ?? "",
        },
      ];
    });
    const net = rows.reduce((t, r) => t + r.net, 0);
    return {
      columns: [
        { header: "Period", value: (r) => r.period },
        ...personCols<StipendRow>(),
        { header: "Payable days", value: (r) => r.payableDays, type: "number" },
        { header: "LOP days", value: (r) => r.lopDays, type: "number" },
        { header: "Gross", value: (r) => r.gross, type: "money" },
        { header: "Deductions", value: (r) => r.deductions, type: "money" },
        { header: "Net", value: (r) => r.net, type: "money" },
        { header: "Status", value: (r) => r.status },
        { header: "Paid on", value: (r) => r.paidOn },
        { header: "Reference", value: (r) => r.reference },
      ],
      rows,
      summary: [
        { label: "Statements", value: String(rows.length) },
        { label: "People", value: String(new Set(rows.map((r) => r.person.id)).size) },
        { label: "Net total", value: inr(net) },
        { label: "Paid", value: String(rows.filter((r) => r.status === statusLabel("payslip", "paid")).length) },
      ],
    };
  },
});

/* ------------------------------------------------------------- intern records */

interface InternRow {
  person: PersonInfo;
  type: string;
  mentor: string;
  college: string;
  course: string;
  startDate: string;
  endDate: string;
  status: string;
  stipend: string;
  presentDays: number;
  hours: number;
  lateDays: number;
  rate?: number;
  certificate: string;
}

const INTERN_STATUSES = ["registered", "active", "extended", "completed", "terminated"];

const internRecords = defineReport<InternRow>({
  key: "intern-records",
  title: "Intern records & attendance",
  group: "HR",
  description: "Interns and trainees with internship dates, mentor, status and attendance for the chosen month.",
  permissions: [...HR],
  filters: [MONTH_FILTER, { key: "status", label: "Internship status", type: "select", options: INTERN_STATUSES.map((s) => ({ value: s, label: statusLabel("internship", s) })) }, DEPARTMENT_FILTER, PERSON_FILTER],
  async run(f) {
    await connectDB();
    const { from, to: monthEnd } = monthRange(f.month || DEFAULTS.thisMonth());
    const today = todayKey();
    const to = monthEnd < today ? monthEnd : today;
    const filter: Record<string, unknown> = { personType: { $in: ["intern", "trainee"] } };
    if (f.department) filter.department = f.department;
    if (f.person) filter._id = f.person;
    if (f.status) filter["internship.status"] = f.status;
    const users = await User.find(filter, { internship: 1 }).sort({ name: 1 }).lean();
    const people = await peopleMap([...users.map((u) => u._id), ...users.map((u) => u.internship?.mentor)]);
    const ctx = await loadAttendance(users.map((u) => u._id.toString()), from, monthEnd);
    const rows: InternRow[] = users.flatMap((u) => {
      const person = people.get(u._id.toString());
      if (!person) return [];
      const i = u.internship;
      const start = [from, i?.startDate, person.joiningDate].filter((d): d is string => Boolean(d)).sort().pop() ?? from;
      const end = i?.endDate && i.endDate < to ? i.endDate : to;
      let present = 0;
      let late = 0;
      let minutes = 0;
      let working = 0;
      for (const day of start > end ? [] : eachDay(start, end)) {
        if (ctx.cal.isWorkingDay(day) && ctx.leaveOn(u._id.toString(), day) !== "full") working += 1;
        const doc = ctx.attendanceOf(u._id.toString(), day);
        if (doc?.checkIn) present += 1;
        if (doc?.late) late += 1;
        minutes += doc?.workMinutes ?? 0;
      }
      return [
        {
          person,
          type: titleCase(person.personType),
          mentor: i?.mentor ? (people.get(i.mentor.toString())?.name ?? "") : "",
          college: i?.college ?? "",
          course: i?.course ?? "",
          startDate: i?.startDate ?? "",
          endDate: i?.endDate ?? "",
          status: i ? statusLabel("internship", i.status) : "",
          stipend: i?.stipend?.eligible ? "Eligible" : "Not eligible",
          presentDays: present,
          hours: hoursOf(minutes),
          lateDays: late,
          rate: working ? Math.min(100, Math.round((present / working) * 100)) : undefined,
          certificate: i ? statusLabel("certificate", i.certificateStatus) : "",
        },
      ];
    });
    return {
      columns: [
        ...personCols<InternRow>(),
        { header: "Type", value: (r) => r.type },
        { header: "Mentor", value: (r) => r.mentor, width: 22 },
        { header: "College", value: (r) => r.college, width: 26 },
        { header: "Course", value: (r) => r.course, width: 22 },
        { header: "Start", value: (r) => fmtDate(r.startDate) },
        { header: "End", value: (r) => fmtDate(r.endDate) },
        { header: "Status", value: (r) => r.status },
        { header: "Stipend", value: (r) => r.stipend },
        { header: "Days present", value: (r) => r.presentDays, type: "number" },
        { header: "Hours", value: (r) => r.hours, type: "number" },
        { header: "Late days", value: (r) => r.lateDays, type: "number" },
        { header: "Attendance %", value: (r) => r.rate, type: "number" },
        { header: "Certificate", value: (r) => r.certificate },
      ],
      rows,
      summary: [
        { label: "Interns & trainees", value: String(rows.length) },
        { label: "Active", value: String(rows.filter((r) => r.status === statusLabel("internship", "active")).length) },
        { label: "Hours logged", value: String(round2(rows.reduce((s, r) => s + r.hours, 0))) },
      ],
    };
  },
});

/* ------------------------------------------------- internship tasks & reviews */

interface InternProgressRow {
  person: PersonInfo;
  assigned: number;
  completed: number;
  overdue: number;
  submissions: number;
  awaitingReview: number;
  approved: number;
  changesRequested: number;
  rating?: number;
  objectives: string;
  lastReview: string;
  lastScore?: number;
  reviewStatus: string;
}

const internshipProgress = defineReport<InternProgressRow>({
  key: "internship-progress",
  title: "Internship task progress & reviews",
  group: "HR",
  description: "Task completion, submission review outcomes, objectives and the latest evaluation per intern.",
  permissions: [...HR],
  filters: [{ key: "status", label: "Internship status", type: "select", options: INTERN_STATUSES.map((s) => ({ value: s, label: statusLabel("internship", s) })) }, DEPARTMENT_FILTER, PERSON_FILTER],
  async run(f) {
    await connectDB();
    const settings = await getSettings();
    const doneKeys = settings.taskStatuses.filter((s) => s.category === "done").map((s) => s.key);
    const closedKeys = settings.taskStatuses.filter((s) => s.category === "done" || s.category === "cancelled").map((s) => s.key);
    const today = todayKey();
    const filter: Record<string, unknown> = { personType: { $in: ["intern", "trainee"] } };
    if (f.department) filter.department = f.department;
    if (f.person) filter._id = f.person;
    if (f.status) filter["internship.status"] = f.status;
    const users = await User.find(filter, { internship: 1 }).sort({ name: 1 }).lean();
    const ids = users.map((u) => u._id);
    const [people, tasks, reviews] = await Promise.all([
      peopleMap(ids),
      Task.find({ assignees: { $in: ids } }, { assignees: 1, status: 1, dueDate: 1, submissions: 1 }).lean(),
      Review.find({ user: { $in: ids } }, { user: 1, date: 1, overall: 1, status: 1, periodLabel: 1 }).sort({ date: -1 }).lean(),
    ]);
    const latestReview = new Map<string, (typeof reviews)[number]>();
    for (const r of reviews) if (!latestReview.has(r.user.toString())) latestReview.set(r.user.toString(), r);

    const rows: InternProgressRow[] = users.flatMap((u) => {
      const person = people.get(u._id.toString());
      if (!person) return [];
      const mine = tasks.filter((t) => t.assignees.some((a) => a.toString() === u._id.toString()));
      const subs = mine.flatMap((t) => t.submissions.filter((s) => s.submittedBy.toString() === u._id.toString()));
      const ratings = subs.map((s) => s.rating).filter((r): r is number => typeof r === "number");
      const objectives = u.internship?.objectives ?? [];
      const review = latestReview.get(u._id.toString());
      return [
        {
          person,
          assigned: mine.length,
          completed: mine.filter((t) => doneKeys.includes(t.status)).length,
          overdue: mine.filter((t) => !closedKeys.includes(t.status) && t.dueDate && t.dueDate < today).length,
          submissions: subs.length,
          awaitingReview: subs.filter((s) => s.reviewStatus === "pending").length,
          approved: subs.filter((s) => s.reviewStatus === "approved").length,
          changesRequested: subs.filter((s) => s.reviewStatus === "changes_requested").length,
          rating: ratings.length ? round2(ratings.reduce((s, r) => s + r, 0) / ratings.length) : undefined,
          objectives: objectives.length ? `${objectives.filter((o) => o.status === "achieved").length} of ${objectives.length} achieved` : "",
          lastReview: review ? `${review.periodLabel} · ${fmtDate(review.date)}` : "",
          lastScore: review?.overall,
          reviewStatus: review ? statusLabel("review", review.status) : "No evaluation",
        },
      ];
    });
    return {
      columns: [
        ...personCols<InternProgressRow>(),
        { header: "Tasks assigned", value: (r) => r.assigned, type: "number" },
        { header: "Completed", value: (r) => r.completed, type: "number" },
        { header: "Overdue", value: (r) => r.overdue, type: "number" },
        { header: "Submissions", value: (r) => r.submissions, type: "number" },
        { header: "Awaiting review", value: (r) => r.awaitingReview, type: "number" },
        { header: "Approved", value: (r) => r.approved, type: "number" },
        { header: "Changes requested", value: (r) => r.changesRequested, type: "number" },
        { header: "Avg task rating", value: (r) => r.rating, type: "number" },
        { header: "Objectives", value: (r) => r.objectives },
        { header: "Latest evaluation", value: (r) => r.lastReview, width: 26 },
        { header: "Overall score (1-5)", value: (r) => r.lastScore, type: "number" },
        { header: "Evaluation status", value: (r) => r.reviewStatus },
      ],
      rows,
      summary: [
        { label: "Interns & trainees", value: String(rows.length) },
        { label: "Tasks assigned", value: String(rows.reduce((s, r) => s + r.assigned, 0)) },
        { label: "Overdue", value: String(rows.reduce((s, r) => s + r.overdue, 0)) },
        { label: "Awaiting review", value: String(rows.reduce((s, r) => s + r.awaitingReview, 0)) },
      ],
    };
  },
});

/* --------------------------------------------------------------- documents */

interface DocumentRow {
  person: PersonInfo;
  issue: "Expired" | "Expiring" | "Missing";
  document: string;
  file: string;
  expiry: string;
  daysLeft?: number;
}

const documentExpiry = defineReport<DocumentRow>({
  key: "document-expiry",
  title: "Document expiry & missing documents",
  group: "HR",
  description: "Documents expired or expiring by a date, plus required documents not yet on file.",
  permissions: [...HR],
  filters: [
    { key: "to", label: "Expiring by", type: "date", defaultValue: () => addDays(todayKey(), 60) },
    {
      key: "kind",
      label: "Show",
      type: "select",
      options: [
        { value: "expiry", label: "Expired / expiring" },
        { value: "missing", label: "Missing required" },
      ],
    },
    DEPARTMENT_FILTER,
    PERSON_FILTER,
  ],
  async run(f) {
    await connectDB();
    const settings = await getSettings();
    const today = todayKey();
    const until = f.to || addDays(today, 60);
    const staff = (await loadStaff(f)).filter((p) => !EXITED_STATUSES.includes(p.status));
    const ids = staff.map((p) => p.id);
    const files = await StoredFile.find(
      { entityType: "user", entityId: { $in: ids }, deletedAt: null, replacedBy: null },
      { entityId: 1, category: 1, name: 1, expiryDate: 1 },
    ).lean();
    const byId = new Map(staff.map((p) => [p.id, p]));
    const label = (key?: string) => settings.documentCategories.find((c) => c.key === key)?.label ?? titleCase(key ?? "Other");
    const rows: DocumentRow[] = [];

    if (f.kind !== "missing") {
      for (const file of files) {
        if (!file.expiryDate || file.expiryDate > until) continue;
        const person = file.entityId ? byId.get(file.entityId) : undefined;
        if (!person) continue;
        const left = diffDays(today, file.expiryDate);
        rows.push({ person, issue: left < 0 ? "Expired" : "Expiring", document: label(file.category), file: file.name, expiry: file.expiryDate, daysLeft: left });
      }
    }
    if (f.kind !== "expiry") {
      const have = new Set(files.map((x) => `${x.entityId}|${x.category}`));
      for (const person of staff) {
        for (const c of settings.documentCategories) {
          if (c.required && c.appliesTo.includes(person.personType) && !have.has(`${person.id}|${c.key}`)) {
            rows.push({ person, issue: "Missing", document: c.label, file: "", expiry: "" });
          }
        }
      }
    }
    const order = { Expired: 0, Expiring: 1, Missing: 2 } as const;
    rows.sort((a, b) => order[a.issue] - order[b.issue] || a.person.name.localeCompare(b.person.name));
    return {
      columns: [
        ...personCols<DocumentRow>(),
        { header: "Issue", value: (r) => r.issue },
        { header: "Document", value: (r) => r.document, width: 30 },
        { header: "File", value: (r) => r.file, width: 28 },
        { header: "Expiry date", value: (r) => fmtDate(r.expiry) },
        { header: "Days left", value: (r) => r.daysLeft, type: "number" },
      ],
      rows,
      summary: [
        { label: "Expired", value: String(rows.filter((r) => r.issue === "Expired").length) },
        { label: "Expiring", value: String(rows.filter((r) => r.issue === "Expiring").length) },
        { label: "Missing required", value: String(rows.filter((r) => r.issue === "Missing").length) },
        { label: "People", value: plural(new Set(rows.map((r) => r.person.id)).size, "person", "people") },
      ],
      note: "Only document names, categories and dates are listed. Confidential file contents are never included.",
    };
  },
});

export const hrReports = [
  employeeDirectory,
  attendanceDaily,
  attendanceMonthly,
  attendanceLateEarly,
  attendanceMissing,
  workingHours,
  attendanceCorrections,
  leaveUsage,
  leaveByEmployee,
  payrollSummary,
  stipendSummary,
  internRecords,
  internshipProgress,
  documentExpiry,
];
