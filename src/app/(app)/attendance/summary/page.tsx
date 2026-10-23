import { forbidden } from "next/navigation";
import { Download } from "lucide-react";
import { PersonCell } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClearFilters, FilterBar, Pagination, SearchInput, SelectFilter } from "@/components/ui/filters";
import { Menu } from "@/components/ui/menu";
import { EmptyRow, TableWrap, THead, Td, Th, Tr } from "@/components/ui/table";
import { PageBody, PageHeader } from "@/components/ui/page";
import { requireUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { AttendanceCorrection } from "@/lib/models";
import { idParam, pageParam, param, type SearchParams } from "@/lib/query";
import { fmtDate, formatDuration, monthKey } from "@/lib/time";
import { MonthNav } from "../_components/month-nav";
import { AttendanceTabs } from "../_components/tabs";
import { attendanceAccess } from "../_lib/access";
import { currentTime } from "../_lib/clock";
import { decidableFilter } from "../_lib/corrections";
import { validMonthParam } from "../_lib/params";
import { loadSummary } from "../_lib/register";

export const metadata = { title: "Attendance summary" };

const PAGE = 50;

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export default async function AttendanceSummaryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const access = await attendanceAccess(user);
  if (!access.canViewTeam) forbidden();
  const sp = await searchParams;
  await connectDB();

  const thisMonth = monthKey(currentTime());
  const requested = validMonthParam(sp, "month") ?? thisMonth;
  const month = requested > thisMonth ? thisMonth : requested;
  const q = param(sp, "q");
  const dept = idParam(sp, "dept");
  const page = pageParam(sp);

  const [{ rows, departments }, pendingCorrections] = await Promise.all([
    loadSummary(access, { month, q, dept }),
    access.canDecide ? AttendanceCorrection.countDocuments({ status: "pending", ...decidableFilter(user, access) }) : Promise.resolve(0),
  ]);
  const pageRows = rows.slice((page - 1) * PAGE, page * PAGE);
  const total = rows.reduce(
    (t, r) => ({
      present: t.present + r.summary.present,
      half: t.half + r.summary.halfDays,
      absent: t.absent + r.summary.absent,
      leave: t.leave + r.summary.leaveDays,
      late: t.late + r.summary.lateCount,
      early: t.early + r.summary.earlyCount,
      minutes: t.minutes + r.summary.workMinutes,
    }),
    { present: 0, half: 0, absent: 0, leave: 0, late: 0, early: 0, minutes: 0 },
  );

  const exportHref = (format: string) => {
    const p = new URLSearchParams({ format, month });
    if (q) p.set("q", q);
    if (dept) p.set("dept", dept);
    return `/attendance/summary/export?${p.toString()}`;
  };

  return (
    <PageBody>
      <PageHeader
        overline={access.viewAll ? "Time · HR view" : "Time · Your team"}
        title="Monthly attendance summary"
        description={`${fmtDate(`${month}-01`, "MMMM yyyy")} · working days are counted up to today for the current month`}
        actions={
          <>
            <MonthNav basePath="/attendance/summary" month={month} maxMonth={thisMonth} params={{ q, dept }} />
            <Menu
              trigger={
                <Button variant="secondary" icon={<Download className="size-4" />}>
                  Export
                </Button>
              }
              items={[
                { label: "CSV", href: exportHref("csv"), external: true },
                { label: "Excel (XLSX)", href: exportHref("xlsx"), external: true },
                { label: "PDF", href: exportHref("pdf"), external: true },
              ]}
            />
          </>
        }
      />
      <AttendanceTabs active="summary" access={access} pendingCorrections={pendingCorrections} />

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3">
          <FilterBar>
            <SearchInput placeholder="Search people" />
            <SelectFilter param="dept" label="Department" allLabel="All departments" options={departments.map((d) => ({ value: d.id, label: d.name }))} />
            <ClearFilters keep={["month"]} />
          </FilterBar>
          <span className="ml-auto text-xs text-muted">{rows.length} people</span>
        </div>
        <TableWrap phone={[1, 3, 5, "last"]} tablet={[1, 3, 4, 5, 6, "last"]}>
          <THead>
            <Th>Person</Th>
            <Th align="right">Working days</Th>
            <Th align="right">Present</Th>
            <Th align="right">Half days</Th>
            <Th align="right">Absent</Th>
            <Th align="right">Leave</Th>
            <Th align="right">Late</Th>
            <Th align="right">Early</Th>
            <Th align="right">Total hours</Th>
          </THead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={9}>No staff match these filters.</EmptyRow>}
            {pageRows.map((r) => (
              <Tr key={r.userId}>
                <Td>
                  <PersonCell name={r.name} sub={[r.employeeId, r.department].filter(Boolean).join(" · ")} />
                </Td>
                <Td align="right">{r.summary.workingDays}</Td>
                <Td align="right" className="font-semibold">
                  {r.summary.present}
                </Td>
                <Td align="right">{r.summary.halfDays}</Td>
                <Td align="right" className={r.summary.absent ? "font-semibold text-danger" : "text-muted"}>
                  {r.summary.absent}
                </Td>
                <Td align="right">{num(r.summary.leaveDays)}</Td>
                <Td align="right" className={r.summary.lateCount ? "text-tone-amber" : "text-muted"}>
                  {r.summary.lateCount}
                </Td>
                <Td align="right">{r.summary.earlyCount}</Td>
                <Td align="right" className="font-semibold">
                  {formatDuration(r.summary.workMinutes)}
                </Td>
              </Tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-line bg-field text-[13px] font-semibold">
                <Td>Total · {rows.length} people</Td>
                <Td align="right">—</Td>
                <Td align="right">{total.present}</Td>
                <Td align="right">{total.half}</Td>
                <Td align="right">{total.absent}</Td>
                <Td align="right">{num(total.leave)}</Td>
                <Td align="right">{total.late}</Td>
                <Td align="right">{total.early}</Td>
                <Td align="right">{formatDuration(total.minutes)}</Td>
              </tr>
            </tfoot>
          )}
        </TableWrap>
        <Pagination page={page} pageSize={PAGE} total={rows.length} />
      </Card>
    </PageBody>
  );
}
