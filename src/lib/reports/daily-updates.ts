import "server-only";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { DailyUpdate } from "@/lib/models";
import { EXITED_STATUSES } from "@/lib/people";
import { fmtDate } from "@/lib/time";
import { DEPARTMENT_FILTER, loadStaff, PERSON_FILTER, peopleMap, projectMap, RANGE_FILTERS, rangeOf, userScope, type PersonInfo } from "./shared";
import { defineReport } from "./types";

/** Rows read per run; exports are capped at the same size (Excel / CSV), PDFs lower. */
const MAX_ROWS = 50_000;

interface DetailRow {
  kind: "detail";
  person: PersonInfo;
  date: string;
  project: string;
  points: string[];
}

interface SummaryRow {
  kind: "summary";
  person: PersonInfo;
  days: number;
  points: number;
  projects: string[];
  first?: string;
  last?: string;
}

type Row = DetailRow | SummaryRow;

const numbered = (points: string[]) => points.map((p, i) => `${i + 1}. ${p}`).join("\n");

/**
 * Daily work report from staff daily updates: every point, day by day and project by project, or one summary row per
 * employee (including staff who posted nothing in the range). Organisation-wide, so it needs `daily_updates.view_all`.
 */
export const dailyWorkReport = defineReport<Row>({
  key: "daily-work",
  title: "Daily work report",
  group: "Projects",
  description: "What each employee reported working on, day by day and project by project, from their daily updates.",
  permissions: ["reports.view", "daily_updates.view_all"],
  filters: [
    ...RANGE_FILTERS,
    PERSON_FILTER,
    DEPARTMENT_FILTER,
    { key: "project", label: "Project", type: "project" },
    {
      key: "view",
      label: "Layout",
      type: "select",
      options: [
        { value: "detail", label: "Every point (detailed)" },
        { value: "summary", label: "Summary per employee" },
      ],
      defaultValue: () => "detail",
    },
  ],
  async run(f) {
    const { from, to } = rangeOf(f);
    const where = and(gte(DailyUpdate.date, from), lte(DailyUpdate.date, to), userScope(f, DailyUpdate.user), f.project ? eq(DailyUpdate.project, f.project) : undefined);
    const updates = await db()
      .select({ user: DailyUpdate.user, date: DailyUpdate.date, project: DailyUpdate.project, points: DailyUpdate.points })
      .from(DailyUpdate)
      .where(where)
      .orderBy(asc(DailyUpdate.date))
      .limit(MAX_ROWS);
    const truncated = updates.length === MAX_ROWS ? `Only the first ${MAX_ROWS.toLocaleString("en-IN")} entries are included — narrow the date range for the rest.` : undefined;

    if (f.view === "summary") {
      const [staff, projects] = await Promise.all([loadStaff(f), projectMap(updates.map((u) => u.project))]);
      const byUser = new Map<string, { days: Set<string>; points: number; projects: Set<string>; first?: string; last?: string }>();
      for (const u of updates) {
        const s = byUser.get(u.user) ?? { days: new Set<string>(), points: 0, projects: new Set<string>() };
        s.days.add(u.date);
        s.points += u.points.length;
        s.projects.add(projects.get(u.project)?.projectNo ?? "Removed project");
        if (!s.first || u.date < s.first) s.first = u.date;
        if (!s.last || u.date > s.last) s.last = u.date;
        byUser.set(u.user, s);
      }
      // Current staff, plus anyone who has since left but posted in the range.
      const rows: SummaryRow[] = staff
        .filter((p) => byUser.has(p.id) || !EXITED_STATUSES.includes(p.status))
        .map((person) => {
          const s = byUser.get(person.id);
          return { kind: "summary", person, days: s?.days.size ?? 0, points: s?.points ?? 0, projects: s ? [...s.projects].sort() : [], first: s?.first, last: s?.last };
        });
      const posted = rows.filter((r) => r.days > 0).length;
      return {
        columns: [
          { header: "Employee", value: (r) => r.person.name, width: 24 },
          { header: "Employee ID", value: (r) => r.person.employeeId, width: 12 },
          { header: "Department", value: (r) => r.person.department, width: 20 },
          { header: "Projects", value: (r) => (r.kind === "summary" ? r.projects.join(", ") : ""), width: 30 },
          { header: "First update", value: (r) => (r.kind === "summary" && r.first ? fmtDate(r.first) : ""), width: 14 },
          { header: "Last update", value: (r) => (r.kind === "summary" && r.last ? fmtDate(r.last) : ""), width: 14 },
          { header: "Points", value: (r) => (r.kind === "summary" ? r.points : 0), type: "number", width: 10 },
          { header: "Days reported", value: (r) => (r.kind === "summary" ? r.days : 0), type: "number", width: 14 },
        ],
        rows,
        summary: [
          { label: "Employees", value: String(rows.length) },
          { label: "Posted updates", value: String(posted) },
          { label: "No updates", value: String(rows.length - posted) },
          { label: "Points", value: String(rows.reduce((n, r) => n + r.points, 0)) },
        ],
        note: truncated ?? "Days reported counts the days with at least one update in the range, whatever the day.",
      };
    }

    const [people, projects] = await Promise.all([peopleMap(updates.map((u) => u.user)), projectMap(updates.map((u) => u.project))]);
    const rows: DetailRow[] = [];
    for (const u of updates) {
      const person = people.get(u.user);
      if (!person) continue;
      const p = projects.get(u.project);
      rows.push({ kind: "detail", person, date: u.date, project: p ? `${p.projectNo} · ${p.title}` : "Removed project", points: u.points });
    }
    // One employee reads as a diary; everyone groups by employee, then day.
    rows.sort((a, b) => a.person.name.localeCompare(b.person.name) || a.date.localeCompare(b.date) || a.project.localeCompare(b.project));
    return {
      columns: [
        { header: "Date", value: (r) => (r.kind === "detail" ? fmtDate(r.date, "EEE, d MMM yyyy") : ""), width: 16 },
        { header: "Employee", value: (r) => r.person.name, width: 24 },
        { header: "Project", value: (r) => (r.kind === "detail" ? r.project : ""), width: 30 },
        { header: "Employee ID", value: (r) => r.person.employeeId, width: 12 },
        { header: "Department", value: (r) => r.person.department, width: 18 },
        { header: "Work done", value: (r) => (r.kind === "detail" ? numbered(r.points) : ""), width: 70, wrap: true },
      ],
      rows,
      summary: [
        { label: "Employees", value: String(new Set(rows.map((r) => r.person.id)).size) },
        { label: "Days reported", value: String(new Set(rows.map((r) => `${r.person.id}|${r.date}`)).size) },
        { label: "Projects", value: String(new Set(rows.map((r) => r.project)).size) },
        { label: "Points", value: String(rows.reduce((n, r) => n + r.points.length, 0)) },
      ],
      note: truncated,
    };
  },
});
