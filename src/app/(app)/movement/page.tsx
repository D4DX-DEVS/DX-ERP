import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq, gte, lt, lte, ne, type SQL } from "drizzle-orm";
import { Download, LogOut, Plus } from "lucide-react";
import { can, isStaff, requireUser, type CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Client, Department, Movement, Project, User, type IMovement } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { directReportIds } from "@/lib/people";
import { displayStatus, isOverdue, movementScope, overdueCutoff, scopeFilter, type MovementScope } from "@/lib/movement/access";
import { dateParam, idParam, PAGE_SIZE, pageParam, param, sortParam, type SearchParams, type SortChoices, withParams } from "@/lib/query";
import { inList, searchAny } from "@/lib/sql";
import { addDays, eachDay, fmtDate, fmtTime, formatDuration, isWorkingWeekday, todayKey, weekStart } from "@/lib/time";
import type { AppSettings } from "@/lib/config-defaults";
import { PageBody, PageHeader, EmptyState, StatCard } from "@/components/ui/page";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/tabs";
import { TableWrap, THead, Th, Tr, Td, EmptyRow } from "@/components/ui/table";
import { StatusChip, Tag } from "@/components/ui/chip";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { FilterBar, SearchInput, SelectFilter, DateFilter, ClearFilters, Pagination, SortSelect } from "@/components/ui/filters";
import { GroupedBarChart } from "@/components/ui/charts";
import { CurrentMovementCard } from "./current-movement-card";
import { ApprovalButtons, LiveElapsed } from "./movement-controls";

export const metadata: Metadata = { title: "Movement register" };

const REVIEW_STATUSES: IMovement["approvalStatus"][] = ["pending", "correction_requested"];

const SORTS = {
  outNewest: { label: "Out time (newest)", order: [desc(Movement.outTime)] },
  outOldest: { label: "Out time (oldest)", order: [asc(Movement.date), asc(Movement.outTime)] },
  longest: { label: "Time outside (longest)", order: [desc(Movement.durationMinutes), desc(Movement.outTime)] },
  logged: { label: "Recently logged", order: [desc(Movement.createdAt)] },
  updated: { label: "Recently updated", order: [desc(Movement.updatedAt)] },
} satisfies SortChoices<SQL[]>;

interface Ctx {
  user: CurrentUser;
  settings: AppSettings;
  today: string;
  reports: Set<string>;
}

function detailsVisible(ctx: Ctx, m: Pick<IMovement, "official" | "user">): boolean {
  if (m.official) return true;
  const uid = m.user;
  return uid === ctx.user.id || ctx.reports.has(uid) || can(ctx.user, "movement.view_personal");
}

export default async function MovementPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const settings = await getSettings();
  const today = todayKey();
  const scope = await movementScope(user);
  const staff = isStaff(user);
  const reports = new Set(await directReportIds(user._id));
  const ctx: Ctx = { user, settings, today, reports };

  const canApproveAny = can(user, "movement.approve") || reports.size > 0;
  const pendingCount = canApproveAny ? await db().$count(Movement, and(approvalFilter(ctx), inList(Movement.approvalStatus, REVIEW_STATUSES))) : 0;

  const defaultTab = scope.kind === "self" ? "mine" : "register";
  const tab = ["register", "mine", "approvals"].includes(param(sp, "tab")) ? param(sp, "tab") : defaultTab;
  const tabs = [
    ...(scope.kind !== "self" ? [{ href: "/movement", label: "Register", active: tab === "register" }] : []),
    ...(staff ? [{ href: "/movement?tab=mine", label: "My movements", active: tab === "mine" }] : []),
    ...(canApproveAny ? [{ href: "/movement?tab=approvals", label: "Approvals", active: tab === "approvals", count: pendingCount }] : []),
  ];
  const canExport = scope.kind !== "self" && can(user, "reports.export");

  return (
    <PageBody>
      <PageHeader
        overline={`Time · ${fmtDate(today, "EEE d MMM yyyy")}`}
        title="Movement register"
        actions={
          <>
            {canExport && tab === "register" && (
              <Menu
                trigger={
                  <button type="button" className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line-strong bg-white px-3.5 text-sm font-semibold text-ink hover:bg-field">
                    <Download className="size-4" /> Export
                  </button>
                }
                items={(["xlsx", "csv", "pdf"] as const).map((f) => ({
                  label: f === "xlsx" ? "Excel (.xlsx)" : f.toUpperCase(),
                  href: withParams(`/movement/export`, sp, { format: f, tab: null }),
                  external: true,
                }))}
              />
            )}
            {can(user, "movement.manage") && (
              <ButtonLink href="/movement/new?mode=late" variant="secondary">
                Record on behalf / late entry
              </ButtonLink>
            )}
            {staff && (
              <ButtonLink href="/movement/new" icon={<LogOut className="size-4" />}>
                Record movement
              </ButtonLink>
            )}
          </>
        }
      />
      {tabs.length > 1 && <LinkTabs items={tabs} />}
      {tab === "register" && scope.kind !== "self" && <RegisterView ctx={ctx} scope={scope} sp={sp} />}
      {tab === "mine" && staff && <MineView ctx={ctx} sp={sp} />}
      {tab === "approvals" && canApproveAny && <ApprovalsView ctx={ctx} />}
      {tab === "register" && scope.kind === "self" && !staff && <EmptyState title="Nothing to show" description="You don't have access to the movement register." />}
    </PageBody>
  );
}

/** Movements the viewer may decide: everyone else's with `movement.approve`, otherwise their direct reports'. */
function approvalFilter(ctx: Ctx): SQL {
  return can(ctx.user, "movement.approve") ? ne(Movement.user, ctx.user._id) : inList(Movement.user, [...ctx.reports]);
}

/* ---------------------------------------------------------------- */

async function RegisterView({ ctx, scope, sp }: { ctx: Ctx; scope: MovementScope; sp: SearchParams }) {
  const { user, settings, today } = ctx;
  const base = scopeFilter(user, scope);
  const from = dateParam(sp, "from") ?? today;
  const to = dateParam(sp, "to") ?? from;
  const page = pageParam(sp);
  const sort = sortParam(sp, SORTS);
  const department = idParam(sp, "department");
  const category = param(sp, "category");
  const approval = param(sp, "approval");
  const status = param(sp, "status");
  const q = param(sp, "q");

  // People filter (department / name search) resolved to user ids.
  let personIds: string[] | undefined;
  if (department || q) {
    const found = await db()
      .select({ id: User._id })
      .from(User)
      .where(and(department ? eq(User.department, department) : undefined, searchAny(q, User.name, User.employeeId)));
    personIds = found.map((u) => u.id);
  }

  const graceAgo = overdueCutoff(settings);
  let dateCond = and(gte(Movement.date, from <= to ? from : to), lte(Movement.date, from <= to ? to : from));
  if (status === "missing_in") dateCond = and(lt(Movement.date, today), gte(Movement.date, from));
  const filter = and(
    base,
    dateCond,
    personIds ? inList(Movement.user, scope.kind === "team" ? personIds.filter((id) => scope.userIds.includes(id)) : personIds) : undefined,
    category ? eq(Movement.category, category) : undefined,
    approval ? eq(Movement.approvalStatus, approval as IMovement["approvalStatus"]) : undefined,
    status === "returned" || status === "cancelled" ? eq(Movement.status, status) : undefined,
    status === "out" || status === "overdue" || status === "missing_in" ? eq(Movement.status, "out") : undefined,
    status === "overdue" ? lt(Movement.expectedReturn, graceAgo) : undefined,
  );

  const monday = weekStart(today);
  const [rows, total, openAll, todayAll, pending, weekRows, departments] = await Promise.all([
    db().select().from(Movement).where(filter).orderBy(...sort.order).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db().$count(Movement, filter),
    db().select().from(Movement).where(and(base, eq(Movement.status, "out"))).orderBy(asc(Movement.outTime)),
    db()
      .select({ status: Movement.status, durationMinutes: Movement.durationMinutes, official: Movement.official })
      .from(Movement)
      .where(and(base, eq(Movement.date, today), ne(Movement.status, "cancelled"))),
    db()
      .select()
      .from(Movement)
      .where(and(base, inList(Movement.approvalStatus, REVIEW_STATUSES), ne(Movement.user, user._id)))
      .orderBy(desc(Movement.updatedAt))
      .limit(6),
    db()
      .select({ date: Movement.date, durationMinutes: Movement.durationMinutes, official: Movement.official })
      .from(Movement)
      .where(and(base, gte(Movement.date, monday), lte(Movement.date, addDays(monday, 6)), eq(Movement.status, "returned"))),
    db().select({ _id: Department._id, name: Department.name }).from(Department).where(eq(Department.active, true)).orderBy(asc(Department.name)),
  ]);

  const peopleIds = [...new Set([...rows, ...openAll, ...pending].map((m) => m.user))];
  const projectIds = [...new Set(rows.map((m) => m.project).filter((x): x is string => Boolean(x)))];
  const clientIds = [...new Set(rows.map((m) => m.client).filter((x): x is string => Boolean(x)))];
  const [people, projects, clients] = await Promise.all([
    db().select({ _id: User._id, name: User.name, employeeId: User.employeeId, photo: User.photo }).from(User).where(inList(User._id, peopleIds)),
    db().select({ _id: Project._id, projectNo: Project.projectNo }).from(Project).where(inList(Project._id, projectIds)),
    db().select({ _id: Client._id, clientNo: Client.clientNo }).from(Client).where(inList(Client._id, clientIds)),
  ]);
  const personById = new Map(people.map((p) => [p._id, { ...p, photo: p.photo ?? undefined }]));
  const projectNo = new Map(projects.map((p) => [p._id, p.projectNo]));
  const clientNo = new Map(clients.map((c) => [c._id, c.clientNo]));

  const missing = openAll.filter((m) => m.date < today);
  const overdue = openAll.filter((m) => m.date >= today && isOverdue(m, settings));
  const returnedToday = todayAll.filter((m) => m.status === "returned");
  const officialToday = returnedToday.filter((m) => m.official).reduce((s, m) => s + (m.durationMinutes ?? 0), 0);
  const personalToday = returnedToday.filter((m) => !m.official).reduce((s, m) => s + (m.durationMinutes ?? 0), 0);
  const [pendingTotal, corrections] = await Promise.all([
    db().$count(Movement, and(base, inList(Movement.approvalStatus, REVIEW_STATUSES))),
    db().$count(Movement, and(base, eq(Movement.approvalStatus, "correction_requested"))),
  ]);

  const workDays = eachDay(monday, addDays(monday, 6)).filter((d) => isWorkingWeekday(d, settings.attendance) || weekRows.some((w) => w.date === d));
  const week = workDays.map((d) => {
    const rowsForDay = weekRows.filter((w) => w.date === d);
    return {
      label: fmtDate(d, "EEE"),
      official: Math.round((rowsForDay.filter((w) => w.official).reduce((s, w) => s + (w.durationMinutes ?? 0), 0) / 60) * 10) / 10,
      personal: Math.round((rowsForDay.filter((w) => !w.official).reduce((s, w) => s + (w.durationMinutes ?? 0), 0) / 60) * 10) / 10,
    };
  });

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Outside now" value={openAll.length} sub="Live" tone={openAll.length ? "alert" : "default"} />
        <StatCard label="Returned today" value={returnedToday.length} sub={`of ${todayAll.length} movements`} />
        <StatCard label="Overdue" value={<span className={overdue.length ? "text-danger" : ""}>{overdue.length}</span>} sub="past expected return" />
        <StatCard label="Missing In-Time" value={<span className={missing.length ? "text-intern" : ""}>{missing.length}</span>} sub={missing.length ? `oldest ${fmtDate(missing[0].date, "EEE d MMM")}` : "none open from earlier days"} />
        <StatCard label="Pending approval" value={<span className={pendingTotal ? "text-warning" : ""}>{pendingTotal}</span>} sub={`${corrections} correction${corrections === 1 ? "" : "s"}`} />
        <StatCard label="Time outside today" value={formatDuration(officialToday + personalToday)} sub={`official ${formatDuration(officialToday)} · personal ${formatDuration(personalToday)}`} />
      </div>

      <Card>
        <CardHeader title="Outside right now" subtitle="Live · elapsed since Out-Time" />
        <CardBody>
          {openAll.length === 0 ? (
            <EmptyState icon={<LogOut className="size-5" />} title="Everyone is in the office" className="py-6" />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {openAll.map((m) => {
                const p = personById.get(m.user);
                const st = displayStatus(m, settings, today);
                const alert = st === "overdue" || st === "missing_in";
                const show = detailsVisible(ctx, m);
                return (
                  <Link
                    key={m._id}
                    href={`/movement/${m._id}`}
                    className={`flex flex-col gap-2 rounded-[14px] bg-white p-3.5 transition-colors hover:bg-field ${alert ? "border-[1.5px] border-[#e7a3a3]" : "border border-line"}`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Avatar name={p?.name ?? "?"} src={p?.photo} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-ink">{p?.name ?? "Unknown"}</div>
                        <div className="truncate text-xs text-muted">{show ? m.categoryLabel : "Personal"}</div>
                      </div>
                      <StatusChip domain="movement" value={st} size="sm" />
                    </div>
                    <div className="truncate text-[13px] text-ink-2">{show ? m.destination || m.purpose : "Personal"}</div>
                    <div className="flex items-baseline justify-between text-[13px]">
                      <LiveElapsed since={m.outTime!.toISOString()} className={`font-display text-lg font-semibold ${alert ? "text-danger" : "text-ink"}`} />
                      <span className="text-muted tabular">
                        {m.date !== today ? fmtDate(m.date, "EEE ") : ""}
                        {fmtTime(m.outTime)} → {m.expectedReturn ? fmtTime(m.expectedReturn) : "—"}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader title="Daily register" subtitle={from === to ? fmtDate(from, "EEEE, d MMM yyyy") : `${fmtDate(from)} – ${fmtDate(to)}`} />
          <div className="px-5 pb-3">
            <FilterBar>
              <SearchInput placeholder="Search person or ID" className="sm:w-56" />
              <DateFilter param="from" label="From" />
              <DateFilter param="to" label="To" />
              <SelectFilter param="department" allLabel="All departments" options={departments.map((d) => ({ value: d._id, label: d.name }))} />
              <SelectFilter param="category" allLabel="All categories" options={settings.movement.categories.map((c) => ({ value: c.key, label: c.label }))} />
              <SelectFilter
                param="status"
                allLabel="Any status"
                options={[
                  { value: "out", label: "Out" },
                  { value: "overdue", label: "Overdue" },
                  { value: "missing_in", label: "Missing In-Time" },
                  { value: "returned", label: "Returned" },
                  { value: "cancelled", label: "Cancelled" },
                ]}
              />
              <SelectFilter
                param="approval"
                allLabel="Any approval"
                options={[
                  { value: "not_required", label: "Not required" },
                  { value: "pending", label: "Pending" },
                  { value: "approved", label: "Approved" },
                  { value: "rejected", label: "Rejected" },
                  { value: "correction_requested", label: "Correction requested" },
                ]}
              />
              <SortSelect options={sort.options} />
              <ClearFilters keep={["tab"]} />
            </FilterBar>
            {!can(user, "movement.view_personal") && <p className="mt-2 text-xs text-muted">Personal movement details are visible to HR and the person&apos;s manager only.</p>}
          </div>
          <TableWrap phone={[2, 5, 9]} tablet={[2, 3, 5, 7, 9, 10]} laptop={[1, 2, 5, 7, 8, 9, 10]} desktop={[1, 2, 3, 5, 7, 8, 9, 10]}>
            <THead>
              <Th>ID</Th>
              <Th>Person</Th>
              <Th>Category · purpose</Th>
              <Th>Reference</Th>
              <Th>Out</Th>
              <Th>Expected</Th>
              <Th>In</Th>
              <Th>Time outside</Th>
              <Th>Movement</Th>
              <Th>Approval</Th>
            </THead>
            <tbody>
              {rows.length === 0 && <EmptyRow colSpan={10}>No movements match these filters.</EmptyRow>}
              {rows.map((m) => {
                const p = personById.get(m.user);
                const st = displayStatus(m, settings, today);
                const show = detailsVisible(ctx, m);
                const ref = (m.project && projectNo.get(m.project)) || (m.client && clientNo.get(m.client)) || "—";
                const lateMins = m.inTime && m.expectedReturn && m.inTime > m.expectedReturn ? Math.round((m.inTime.getTime() - m.expectedReturn.getTime()) / 60_000) : 0;
                return (
                  <Tr key={m._id} href={`/movement/${m._id}`}>
                    <Td className="font-mono text-xs whitespace-nowrap">
                      <Link href={`/movement/${m._id}`} className="text-brand-600 hover:underline">
                        {m.movementNo}
                      </Link>
                      {m.entryMode === "alternative" && <Tag tone="purple" className="ml-1.5">Late</Tag>}
                    </Td>
                    <Td className="font-semibold">{p?.name ?? "—"}</Td>
                    <Td>
                      <div className="font-medium">{show ? m.categoryLabel : "Personal"}</div>
                      <div className="line-clamp-2 max-w-[220px] text-xs text-muted">{show ? m.purpose : "Personal"}</div>
                    </Td>
                    <Td className="text-xs whitespace-nowrap">{ref}</Td>
                    <Td className="tabular whitespace-nowrap">{m.date !== today && from === to && from === today ? fmtDate(m.date, "EEE ") : ""}{fmtTime(m.outTime)}</Td>
                    <Td className="tabular whitespace-nowrap">{fmtTime(m.expectedReturn)}</Td>
                    <Td className="tabular whitespace-nowrap">{m.inTime ? fmtTime(m.inTime) : "—"}</Td>
                    <Td>
                      {m.status === "out" ? (
                        <span className="font-semibold text-tone-orange">
                          <LiveElapsed since={m.outTime!.toISOString()} /> running
                        </span>
                      ) : m.durationMinutes != null ? (
                        <span className="font-semibold tabular">
                          {formatDuration(m.durationMinutes)}
                          {lateMins > 0 && <span className="block font-medium text-danger">late {formatDuration(lateMins)}</span>}
                        </span>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>
                      <StatusChip domain="movement" value={st} size="sm" />
                    </Td>
                    <Td>
                      <StatusChip domain="movementApproval" value={m.approvalStatus} size="sm" />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </TableWrap>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
          <div className="border-t border-line-soft px-5 py-3 text-xs text-muted">
            Time outside = In-Time − Out-Time on full date-times. Open movements show elapsed time and get no final duration until closed.
          </div>
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Time outside this week" subtitle="Hours, returned movements" />
            <CardBody>
              <GroupedBarChart
                data={week}
                stacked
                height={200}
                series={[
                  { key: "official", label: "Official", color: "#284CC7" },
                  { key: "personal", label: "Personal", color: "#D0691F" },
                ]}
                format="hours"
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Pending approvals & corrections" href="/movement?tab=approvals" hrefLabel="All" />
            <CardBody className="flex flex-col gap-2.5">
              {pending.length === 0 && <p className="text-[13px] text-muted">Nothing waiting.</p>}
              {pending.map((m) => {
                const p = personById.get(m.user);
                const show = detailsVisible(ctx, m);
                const corr = m.approvalStatus === "correction_requested";
                return (
                  <div key={m._id} data-href={`/movement/${m._id}`} className="flex cursor-pointer items-center gap-3 rounded-xl border border-line p-3">
                    <Link href={`/movement/${m._id}`} className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-ink">
                        {p?.name ?? "—"} · {corr ? "correction" : show ? m.categoryLabel.toLowerCase() : "personal"}
                        {show && !corr ? ` · ${m.purpose}` : ""}
                      </div>
                      <div className="truncate text-xs text-muted">
                        {fmtDate(m.date, "EEE d MMM")} · {fmtTime(m.outTime)} – {m.inTime ? fmtTime(m.inTime) : "open"}
                        {m.durationMinutes != null ? ` · ${formatDuration(m.durationMinutes)}` : ""}
                      </div>
                    </Link>
                    {!corr && (ctx.reports.has(m.user) || can(user, "movement.approve")) && <ApprovalButtons id={m._id} compact />}
                  </div>
                );
              })}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- */

async function MineView({ ctx, sp }: { ctx: Ctx; sp: SearchParams }) {
  const { user, settings, today } = ctx;
  const from = dateParam(sp, "from") ?? addDays(today, -30);
  const to = dateParam(sp, "to") ?? today;
  const page = pageParam(sp);
  const sort = sortParam(sp, SORTS);
  const filter = and(eq(Movement.user, user._id), gte(Movement.date, from), lte(Movement.date, to));
  const [rows, total, totals] = await Promise.all([
    db().select().from(Movement).where(filter).orderBy(...sort.order).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db().$count(Movement, filter),
    db()
      .select({ durationMinutes: Movement.durationMinutes, official: Movement.official })
      .from(Movement)
      .where(and(filter, eq(Movement.status, "returned"))),
  ]);
  const official = totals.filter((m) => m.official).reduce((s, m) => s + (m.durationMinutes ?? 0), 0);
  const personal = totals.filter((m) => !m.official).reduce((s, m) => s + (m.durationMinutes ?? 0), 0);

  return (
    <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
      <div className="flex flex-col gap-5">
        <CurrentMovementCard userId={user.id} />
        <Card>
          <CardHeader title="Summary" subtitle={`${fmtDate(from)} – ${fmtDate(to)}`} />
          <CardBody className="grid grid-cols-2 gap-3 text-[13px]">
            <div>
              <div className="text-muted">Movements</div>
              <div className="font-display text-xl font-semibold">{total}</div>
            </div>
            <div>
              <div className="text-muted">Time outside</div>
              <div className="font-display text-xl font-semibold">{formatDuration(official + personal)}</div>
            </div>
            <div>
              <div className="text-muted">Official</div>
              <div className="font-semibold">{formatDuration(official)}</div>
            </div>
            <div>
              <div className="text-muted">Personal</div>
              <div className="font-semibold">{formatDuration(personal)}</div>
            </div>
          </CardBody>
        </Card>
        <ButtonLink href="/movement/new?mode=late" variant="secondary" icon={<Plus className="size-4" />}>
          Add late entry or correction
        </ButtonLink>
      </div>
      <Card>
        <CardHeader title="My movement history" />
        <div className="px-5 pb-3">
          <FilterBar>
            <DateFilter param="from" label="From" />
            <DateFilter param="to" label="To" />
            <SortSelect options={sort.options} />
            <ClearFilters keep={["tab"]} />
          </FilterBar>
        </div>
        <TableWrap phone={[1, 5, 6]} tablet={[1, 2, 3, 4, 5, 6]}>
          <THead>
            <Th>Date</Th>
            <Th>Category · purpose</Th>
            <Th>Out</Th>
            <Th>In</Th>
            <Th>Time outside</Th>
            <Th>Status</Th>
          </THead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={6}>No movements in this period.</EmptyRow>}
            {rows.map((m) => (
              <Tr key={m._id} href={`/movement/${m._id}`}>
                <Td className="whitespace-nowrap">
                  <Link href={`/movement/${m._id}`} className="font-semibold text-brand-600 hover:underline">
                    {fmtDate(m.date, "EEE d MMM")}
                  </Link>
                  <div className="font-mono text-[11px] text-muted">{m.movementNo}</div>
                </Td>
                <Td>
                  <div className="font-medium">{m.categoryLabel}</div>
                  <div className="max-w-[280px] truncate text-xs text-muted">{m.purpose}</div>
                </Td>
                <Td className="tabular">{fmtTime(m.outTime)}</Td>
                <Td className="tabular">{m.inTime ? fmtTime(m.inTime) : "—"}</Td>
                <Td className="font-semibold tabular">{m.durationMinutes != null ? formatDuration(m.durationMinutes) : m.status === "out" ? <LiveElapsed since={m.outTime!.toISOString()} className="text-tone-orange" /> : "—"}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    <StatusChip domain="movement" value={displayStatus(m, settings, today)} size="sm" />
                    {m.approvalStatus !== "not_required" && <StatusChip domain="movementApproval" value={m.approvalStatus} size="sm" />}
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- */

async function ApprovalsView({ ctx }: { ctx: Ctx }) {
  const { user } = ctx;
  const filter = approvalFilter(ctx);
  const [pending, decided] = await Promise.all([
    db().select().from(Movement).where(and(filter, inList(Movement.approvalStatus, REVIEW_STATUSES))).orderBy(asc(Movement.createdAt)).limit(100),
    db().select().from(Movement).where(and(filter, eq(Movement.approvedBy, user._id))).orderBy(desc(Movement.approvedAt)).limit(15),
  ]);
  const people = await db()
    .select({ _id: User._id, name: User.name, photo: User.photo, employeeId: User.employeeId })
    .from(User)
    .where(inList(User._id, [...new Set([...pending, ...decided].map((m) => m.user))]));
  const byId = new Map(people.map((p) => [p._id, { ...p, photo: p.photo ?? undefined }]));

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader title="Waiting for your decision" subtitle={`${pending.length} item${pending.length === 1 ? "" : "s"}`} />
        <CardBody className="flex flex-col gap-3">
          {pending.length === 0 && <EmptyState title="No pending approvals" description="Movements and corrections that need your decision appear here." className="py-8" />}
          {pending.map((m) => {
            const p = byId.get(m.user);
            const corr = m.approvalStatus === "correction_requested";
            const c = m.corrections.find((x) => x.status === "pending");
            const show = detailsVisible(ctx, m);
            return (
              <div key={m._id} data-href={`/movement/${m._id}`} className="flex cursor-pointer flex-col gap-3 rounded-[14px] border border-line p-4 sm:flex-row sm:items-center">
                <Avatar name={p?.name ?? "?"} src={p?.photo} size="md" />
                <Link href={`/movement/${m._id}`} className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-ink">
                    {p?.name ?? "—"} · {corr ? "Correction request" : show ? m.categoryLabel : "Personal"}
                    {m.entryMode === "alternative" && <Tag tone="purple" className="ml-2">Late entry</Tag>}
                  </div>
                  <div className="text-[13px] text-muted">
                    {m.movementNo} · {fmtDate(m.date, "EEE d MMM")} · {fmtTime(m.outTime)} – {m.inTime ? fmtTime(m.inTime) : "open"}
                    {m.durationMinutes != null ? ` · ${formatDuration(m.durationMinutes)}` : ""}
                  </div>
                  <div className="mt-1 text-[13px] text-ink-2">
                    {corr && c ? `Proposed ${fmtTime(c.proposedOutTime)} – ${c.proposedInTime ? fmtTime(c.proposedInTime) : "open"} · ${c.reason}` : show ? m.purpose : "Personal"}
                    {!corr && m.alternativeReason && show ? ` · Late entry: ${m.alternativeReason}` : ""}
                  </div>
                </Link>
                {corr ? (
                  <ButtonLink href={`/movement/${m._id}`} variant="secondary" size="sm">
                    Review
                  </ButtonLink>
                ) : (
                  <ApprovalButtons id={m._id} />
                )}
              </div>
            );
          })}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Recently decided by you" />
        <CardBody className="flex flex-col divide-y divide-line-soft pt-0">
          {decided.length === 0 && <p className="py-3 text-[13px] text-muted">No decisions yet.</p>}
          {decided.map((m) => (
            <Link key={m._id} href={`/movement/${m._id}`} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold">{byId.get(m.user)?.name ?? "—"} · {detailsVisible(ctx, m) ? m.categoryLabel : "Personal"}</span>
                <span className="text-xs text-muted">{fmtDate(m.date, "d MMM")} · {m.movementNo}</span>
              </span>
              <StatusChip domain="movementApproval" value={m.approvalStatus} size="sm" />
            </Link>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
