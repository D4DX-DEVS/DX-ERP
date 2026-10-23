import { forbidden } from "next/navigation";
import { Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClearFilters, DateFilter, FilterBar, Pagination, SearchInput, SelectFilter } from "@/components/ui/filters";
import { Menu } from "@/components/ui/menu";
import { Alert, EmptyState, PageBody, PageHeader, StatCard } from "@/components/ui/page";
import { PersonCell } from "@/components/ui/avatar";
import { EmptyRow, TableWrap, THead, Td, Th, Tr } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { peopleOptions } from "@/lib/people";
import { AttendanceCorrection } from "@/lib/models";
import { idParam, pageParam, param, type SearchParams } from "@/lib/query";
import { fmtDate, fmtTime, formatDuration, timeOf, todayKey } from "@/lib/time";
import { cn } from "@/lib/cn";
import { DayChips } from "../_components/day-chip";
import { ManualEntryDialog } from "../_components/manual-entry-dialog";
import { AttendanceTabs } from "../_components/tabs";
import { attendanceAccess } from "../_lib/access";
import { decidableFilter } from "../_lib/corrections";
import { dayParam } from "../_lib/params";
import { isEarly, isLate, isPresent, loadRegister, matchesStatus, REGISTER_STATUS_OPTIONS, type RegisterRow } from "../_lib/register";

export const metadata = { title: "Daily attendance" };

const PAGE = 50;

function RightNow({ row, isToday }: { row: RegisterRow; isToday: boolean }) {
  if (!isToday) return <span className="text-muted">—</span>;
  if (row.outside) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-outside">
        <span className="size-2 rounded-full bg-outside" aria-hidden />
        {row.outside.label === "Out" ? "Outside · movement" : `Outside · ${row.outside.label}`}
      </span>
    );
  }
  if (row.key === "in_progress") {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span className="size-2 rounded-full bg-[#12935f]" aria-hidden />
        In office
      </span>
    );
  }
  return <span className="text-muted">—</span>;
}

function flagsFor(row: RegisterRow): string[] {
  const flags: string[] = [];
  if (isLate(row) && row.lateMinutes > 0) flags.push(`Late ${row.lateMinutes}m`);
  if (isEarly(row) && row.earlyMinutes > 0) flags.push(`Early ${row.earlyMinutes}m`);
  if (row.outside?.overdue) flags.push("Overdue return");
  if (row.outside?.fromEarlierDay) flags.push(`Open movement since ${fmtDate(row.outside.since, "EEE d MMM")}`);
  return flags;
}

export default async function TeamAttendancePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const access = await attendanceAccess(user);
  if (!access.canViewTeam) forbidden();
  const sp = await searchParams;
  await connectDB();

  const today = todayKey();
  const date = dayParam(sp, "date") ?? today;
  const q = param(sp, "q");
  const dept = idParam(sp, "dept");
  const status = param(sp, "status");
  const page = pageParam(sp);

  const [register, pendingCorrections, staffOptions] = await Promise.all([
    loadRegister(access, { date, q, dept }),
    access.canDecide ? AttendanceCorrection.countDocuments({ status: "pending", ...decidableFilter(user, access) }) : Promise.resolve(0),
    access.manage ? peopleOptions() : Promise.resolve([]),
  ]);
  const { rows } = register;

  const tiles = {
    present: rows.filter(isPresent).length,
    late: rows.filter(isLate).length,
    absent: rows.filter((r) => r.key === "absent").length,
    onLeave: rows.filter((r) => r.key === "on_leave" || r.key === "half_leave").length,
    outside: rows.filter((r) => r.outside).length,
    missing: rows.filter((r) => r.key === "missing_checkout").length,
  };
  const filtered = rows.filter((r) => matchesStatus(r, status));
  const pageRows = filtered.slice((page - 1) * PAGE, page * PAGE);

  const exportHref = (format: string) => {
    const p = new URLSearchParams({ format, date });
    if (q) p.set("q", q);
    if (dept) p.set("dept", dept);
    if (status) p.set("status", status);
    return `/attendance/team/export?${p.toString()}`;
  };

  const canManage = access.manage;

  return (
    <PageBody>
      <PageHeader
        overline={access.viewAll ? "Time · HR view" : "Time · Your team"}
        title="Daily attendance"
        description={`${fmtDate(date, "EEEE, d MMMM yyyy")}${register.isToday ? " · today" : ""}`}
        actions={
          <>
            <DateFilter param="date" label="Date" />
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
            {canManage && (
              <ManualEntryDialog
                today={today}
                people={staffOptions}
                defaults={{ date }}
                trigger={<Button icon={<Plus className="size-4" />}>Manual entry</Button>}
              />
            )}
          </>
        }
      />
      <AttendanceTabs active="team" access={access} pendingCorrections={pendingCorrections} />

      {register.holidayName && <Alert tone="info" title={`Holiday: ${register.holidayName}.`}>Nobody is expected to attend today unless they check in.</Alert>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Present" value={tiles.present} />
        <StatCard label="Late" value={tiles.late} />
        <StatCard label="Absent" value={tiles.absent} tone={tiles.absent ? "alert" : "default"} />
        <StatCard label="On leave" value={tiles.onLeave} />
        <StatCard label="Outside now" value={register.isToday ? tiles.outside : "—"} tone={tiles.outside && register.isToday ? "alert" : "default"} />
        <StatCard label="Missing check-out" value={tiles.missing} tone={tiles.missing ? "alert" : "default"} />
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3">
          <FilterBar>
            <SearchInput placeholder="Search people" />
            <SelectFilter param="dept" label="Department" allLabel="All departments" options={register.departments.map((d) => ({ value: d.id, label: d.name }))} />
            <SelectFilter param="status" label="Status" allLabel="All statuses" options={REGISTER_STATUS_OPTIONS} />
            <ClearFilters keep={["date"]} />
          </FilterBar>
          <span className="ml-auto text-xs text-muted">{filtered.length} of {rows.length} people</span>
        </div>
        {rows.length === 0 ? (
          <EmptyState title="No staff to show" description={access.viewAll ? "No active staff match these filters." : "Nobody reports to you, or no one matches these filters."} />
        ) : (
          <>
            <TableWrap phone={[1, 2, 8]} tablet={[1, 2, 3, 5, 8, "last"]} laptop={[1, 2, 3, 4, 5, 7, 8, "last"]}>
              <THead>
                <Th>Person</Th>
                <Th>Check-in</Th>
                <Th>Check-out</Th>
                <Th>Break</Th>
                <Th>Right now</Th>
                <Th>Movements</Th>
                <Th>Worked</Th>
                <Th>Status</Th>
                <Th>Flags</Th>
                {canManage && <Th className="w-16">
                  <span className="sr-only">Actions</span>
                </Th>}
              </THead>
              <tbody>
                {pageRows.length === 0 && <EmptyRow colSpan={canManage ? 10 : 9}>No one matches the selected status.</EmptyRow>}
                {pageRows.map((r) => (
                  <Tr key={r.userId}>
                    <Td>
                      <PersonCell name={r.name} photo={r.photo} sub={[r.department, r.personType !== "employee" ? r.personType[0].toUpperCase() + r.personType.slice(1) : undefined].filter(Boolean).join(" · ") || r.employeeId} />
                    </Td>
                    <Td className="tabular">{r.checkIn ? fmtTime(r.checkIn) : <span className="text-muted">—</span>}</Td>
                    <Td className="tabular">{r.checkOut ? fmtTime(r.checkOut) : <span className="text-muted">—</span>}</Td>
                    <Td className="tabular">{r.checkIn ? formatDuration(r.breakMinutes) : <span className="text-muted">—</span>}</Td>
                    <Td>
                      <RightNow row={r} isToday={register.isToday} />
                    </Td>
                    <Td className="tabular whitespace-nowrap">
                      {r.movementCount > 0 ? (
                        <>
                          {r.movementCount} · {formatDuration(r.movementMinutes)}
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </Td>
                    <Td className="font-semibold tabular">
                      {r.workMinutes != null ? (
                        <>
                          {formatDuration(r.workMinutes)}
                          {!r.checkOut && <span className="ml-1 text-xs font-normal text-muted">so far</span>}
                        </>
                      ) : r.key === "missing_checkout" ? (
                        <span className="text-xs font-normal text-muted">Provisional</span>
                      ) : (
                        <span className="font-normal text-muted">—</span>
                      )}
                    </Td>
                    <Td>
                      <DayChips cls={{ key: r.key, extras: r.extras }} />
                      {r.note && <div className="mt-1 text-xs text-muted">{r.note}</div>}
                    </Td>
                    <Td className={cn("text-xs font-semibold", flagsFor(r).length ? "text-tone-amber" : "text-muted")}>
                      {flagsFor(r).length ? flagsFor(r).map((f) => <div key={f}>{f}</div>) : "—"}
                    </Td>
                    {canManage && (
                      <Td>
                        <ManualEntryDialog
                          today={today}
                          people={[{ id: r.userId, name: r.name, employeeId: r.employeeId, personType: r.personType, designation: r.designation, photo: r.photo }]}
                          defaults={{ userId: r.userId, date, checkIn: r.checkIn ? timeOf(r.checkIn) : undefined, checkOut: r.checkOut ? timeOf(r.checkOut) : undefined }}
                          trigger={
                            <Button size="sm" variant="ghost" aria-label={`Edit attendance for ${r.name}`}>
                              Edit
                            </Button>
                          }
                        />
                      </Td>
                    )}
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination page={page} pageSize={PAGE} total={filtered.length} />
          </>
        )}
      </Card>
    </PageBody>
  );
}
