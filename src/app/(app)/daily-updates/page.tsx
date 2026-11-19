import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { FileChartColumn, NotebookPen } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ClearFilters, DateFilter, FilterBar, Pagination, SelectFilter } from "@/components/ui/filters";
import { EmptyState, PageBody, PageHeader } from "@/components/ui/page";
import { LinkTabs } from "@/components/ui/tabs";
import { isStaff, requireUser, type CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { DailyUpdate, Project, User } from "@/lib/models";
import { dateParam, idParam, PAGE_SIZE, pageParam, param, type SearchParams } from "@/lib/query";
import { canOpenReport, getReport } from "@/lib/reports/registry";
import { getSettings } from "@/lib/settings";
import { inList } from "@/lib/sql";
import { addDays, fmtDate, todayKey } from "@/lib/time";
import { loggableProjectIds, peopleMap, PROJECT_CLOSED_CATEGORIES, type Filter } from "@/lib/work-access";
import { DayPicker } from "./day-picker";
import { dailyUpdateScope } from "./scope";
import { DayUpdateCard, type DayUpdate } from "./update-card";
import { UpdateEditor, type ProjectOption } from "./update-editor";

export const metadata = { title: "Daily updates" };

const projectLabel = (p: { projectNo: string | null; title: string | null }) => (p.title ? `${p.projectNo} · ${p.title}` : "Removed project");

/** "Wed, 18 Nov" this year, "18 Nov 2025" before. */
const dayLabel = (date: string, today: string) => fmtDate(date, date.slice(0, 4) === today.slice(0, 4) ? "EEE, d MMM" : "d MMM yyyy");

/** Days the Team tab shows: its From / To filters, or just today when neither is set. `day` is set for a single day. */
interface TeamPeriod {
  from?: string;
  to?: string;
  day?: string;
}

function teamPeriod(sp: SearchParams, today: string): TeamPeriod {
  const from = dateParam(sp, "from");
  const to = dateParam(sp, "to");
  if (!from && !to) return { from: today, to: today, day: today };
  return { from, to, day: from && from === to ? from : undefined };
}

/**
 * Pages through (person, day) groups matching `where`, newest day first, and returns them with their projects and points.
 * Three queries whatever the page size: the groups, their count, and their rows.
 */
async function dayUpdates(where: Filter, page: number, withPeople: boolean): Promise<{ total: number; days: DayUpdate[] }> {
  const groupKey = sql`${DailyUpdate.user} || '|' || ${DailyUpdate.date}`;
  const [groups, [counted]] = await Promise.all([
    db()
      .selectDistinct({ user: DailyUpdate.user, date: DailyUpdate.date, name: User.name })
      .from(DailyUpdate)
      .innerJoin(User, eq(User._id, DailyUpdate.user))
      .where(where)
      .orderBy(desc(DailyUpdate.date), asc(User.name))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db()
      .select({ n: sql<number>`count(distinct ${groupKey})`.mapWith(Number) })
      .from(DailyUpdate)
      .where(where),
  ]);
  if (groups.length === 0) return { total: counted?.n ?? 0, days: [] };

  const users = [...new Set(groups.map((g) => g.user))];
  const [rows, people] = await Promise.all([
    db()
      .select({
        user: DailyUpdate.user,
        date: DailyUpdate.date,
        project: DailyUpdate.project,
        points: DailyUpdate.points,
        updatedAt: DailyUpdate.updatedAt,
        projectNo: Project.projectNo,
        title: Project.title,
      })
      .from(DailyUpdate)
      .leftJoin(Project, eq(Project._id, DailyUpdate.project))
      .where(and(where, inList(DailyUpdate.user, users), inList(DailyUpdate.date, [...new Set(groups.map((g) => g.date))])))
      .orderBy(desc(Project.projectNo)),
    withPeople ? peopleMap(users) : Promise.resolve(new Map<string, { name: string; photo?: string }>()),
  ]);

  const byGroup = new Map<string, DayUpdate>();
  for (const g of groups) {
    const key = `${g.user}|${g.date}`;
    const person = people.get(g.user);
    byGroup.set(key, { key, date: g.date, person: withPeople ? { name: person?.name ?? g.name, photo: person?.photo } : undefined, projects: [], updatedAt: new Date(0) });
  }
  for (const r of rows) {
    const day = byGroup.get(`${r.user}|${r.date}`);
    if (!day) continue;
    day.projects.push({ id: r.project, label: projectLabel(r), points: r.points });
    if (r.updatedAt > day.updatedAt) day.updatedAt = r.updatedAt;
  }
  return { total: counted?.n ?? 0, days: [...byGroup.values()] };
}

async function MyUpdates({ user, sp }: { user: CurrentUser; sp: SearchParams }) {
  const today = todayKey();
  const requested = dateParam(sp, "date");
  const date = requested && requested < today ? requested : today;
  const mine = eq(DailyUpdate.user, user._id);

  const [loggable, dayRows, settings] = await Promise.all([
    loggableProjectIds(user),
    db().select({ project: DailyUpdate.project, points: DailyUpdate.points }).from(DailyUpdate).where(and(mine, eq(DailyUpdate.date, date))),
    getSettings(),
  ]);

  // Assigned projects that are still running, plus any project already in this day's update.
  const dayProjects = new Set(dayRows.map((r) => r.project));
  const closed = new Set(settings.projectStatuses.filter((s) => PROJECT_CLOSED_CATEGORIES.includes(s.category)).map((s) => s.key));
  const projectRows = await db()
    .select({ id: Project._id, projectNo: Project.projectNo, title: Project.title, status: Project.status })
    .from(Project)
    .where(inList(Project._id, [...new Set([...loggable, ...dayProjects])]))
    .orderBy(desc(Project.projectNo));
  const projects: ProjectOption[] = projectRows.filter((p) => dayProjects.has(p.id) || !closed.has(p.status)).map((p) => ({ id: p.id, label: projectLabel(p) }));
  const order = new Map(projects.map((p, i) => [p.id, i]));
  const initial = dayRows
    .filter((r) => order.has(r.project))
    .sort((a, b) => order.get(a.project)! - order.get(b.project)!)
    .map((r) => ({ project: r.project, points: r.points }));

  // Only the chosen day's update: earlier days are reached with the day picker.
  return (
    <Card>
      <CardHeader
        title={date === today && !dayRows.length ? "What did you work on today?" : "Your update"}
        subtitle={dayRows.length ? "Posted — edit the points and save to update it." : "Add the projects you worked on and list your points."}
        action={<DayPicker date={date} today={today} label={dayLabel(date, today)} prev={addDays(date, -1)} next={date < today ? addDays(date, 1) : undefined} />}
      />
      <CardBody>
        <UpdateEditor key={date} date={date} projects={projects} initial={initial} exists={dayRows.length > 0} />
      </CardBody>
    </Card>
  );
}

async function TeamUpdates({ scope, sp, period, today }: { scope: Filter; sp: SearchParams; period: TeamPeriod; today: string }) {
  const page = pageParam(sp);
  const { from, to, day } = period;
  const person = idParam(sp, "person");
  const project = idParam(sp, "project");
  // Day links keep the tab and the person / project filters; the day replaces any period.
  const keep = new URLSearchParams([["tab", "team"], ...(person ? [["person", person]] : []), ...(project ? [["project", project]] : [])]).toString();
  const short = (d: string) => fmtDate(d, d.slice(0, 4) === today.slice(0, 4) ? "d MMM" : "d MMM yyyy");
  const periodLabel = from && to ? `${short(from)} – ${short(to)}` : from ? `From ${short(from)}` : `Until ${short(to!)}`;
  const where = and(
    scope,
    person ? eq(DailyUpdate.user, person) : undefined,
    project ? eq(DailyUpdate.project, project) : undefined,
    from ? gte(DailyUpdate.date, from) : undefined,
    to ? lte(DailyUpdate.date, to) : undefined,
  );

  // Filter choices: only people and projects that appear in the updates this user may read.
  const [list, people, projects] = await Promise.all([
    dayUpdates(where, page, true),
    db().selectDistinct({ id: User._id, name: User.name }).from(DailyUpdate).innerJoin(User, eq(User._id, DailyUpdate.user)).where(scope).orderBy(asc(User.name)),
    db()
      .selectDistinct({ id: Project._id, projectNo: Project.projectNo, title: Project.title })
      .from(DailyUpdate)
      .innerJoin(Project, eq(Project._id, DailyUpdate.project))
      .where(scope)
      .orderBy(desc(Project.projectNo)),
  ]);

  return (
    <>
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="flex items-center gap-1">
          {day ? (
            <DayPicker date={day} today={today} label={dayLabel(day, today)} prev={addDays(day, -1)} next={day < today ? addDays(day, 1) : undefined} keep={keep} range className="h-10" />
          ) : (
            <DayPicker date={to && to < today ? to : today} today={today} label={periodLabel} period keep={keep} range className="h-10" />
          )}
          {day !== today && (
            <ButtonLink href={`/daily-updates?${keep}`} variant="ghost" size="sm" scroll={false}>
              Today
            </ButtonLink>
          )}
        </div>
        <FilterBar>
          <DateFilter param="from" label="From" />
          <DateFilter param="to" label="To" />
          <SelectFilter param="person" allLabel="All people" label="Person" options={people.map((p) => ({ value: p.id, label: p.name }))} />
          <SelectFilter param="project" allLabel="All projects" label="Project" options={projects.map((p) => ({ value: p.id, label: projectLabel(p) }))} />
          <ClearFilters keep={["tab"]} />
        </FilterBar>
      </div>
      {list.days.length === 0 ? (
        <Card>
          <EmptyState
            icon={<NotebookPen className="size-5" />}
            title={day === today ? "No updates yet today" : day ? `No updates on ${dayLabel(day, today)}` : "No updates found"}
            description={person || project ? "Try clearing the filters." : day === today ? "Updates your team posts today will show here." : day ? "Try the previous day or pick a period." : "Try a wider period."}
          />
        </Card>
      ) : (
        <>
          {list.days.map((d) => (
            <DayUpdateCard key={d.key} update={d} />
          ))}
          {list.total > PAGE_SIZE && (
            <Card>
              <Pagination page={page} pageSize={PAGE_SIZE} total={list.total} />
            </Card>
          )}
        </>
      )}
    </>
  );
}

export default async function DailyUpdatesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const staff = isStaff(user);
  const scope = await dailyUpdateScope(user);
  const tab = !staff || (scope.hasTeam && param(sp, "tab") === "team") ? "team" : "mine";
  const teamLabel = scope.all ? "All updates" : "Team updates";
  const today = todayKey();
  const period = teamPeriod(sp, today);
  // Admins get the organisation-wide work report (Reports module), opened with the filters in use here.
  const report = getReport("daily-work");
  const reportQuery = new URLSearchParams(
    [
      ["from", period.from],
      ["to", period.to],
      ["person", idParam(sp, "person")],
      ["project", idParam(sp, "project")],
    ].filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();
  const reportButton =
    tab === "team" && scope.all && report && canOpenReport(user, report) ? (
      <ButtonLink href={`/reports/daily-work${reportQuery ? `?${reportQuery}` : ""}`} variant="secondary" icon={<FileChartColumn className="size-4" aria-hidden />}>
        Work report
      </ButtonLink>
    ) : undefined;

  return (
    <PageBody>
      <PageHeader
        overline="Work"
        title="Daily updates"
        description={tab === "mine" ? "Post what you worked on each day, project by project." : scope.all ? "Everyone's daily updates." : "Daily updates from the people you lead and the projects you manage."}
        actions={reportButton}
      />
      {staff && scope.hasTeam && (
        <LinkTabs
          items={[
            { href: "/daily-updates", label: "My updates", active: tab === "mine" },
            { href: "/daily-updates?tab=team", label: teamLabel, active: tab === "team" },
          ]}
        />
      )}
      {tab === "mine" ? <MyUpdates user={user} sp={sp} /> : <TeamUpdates scope={scope.filter} sp={sp} period={period} today={today} />}
    </PageBody>
  );
}
