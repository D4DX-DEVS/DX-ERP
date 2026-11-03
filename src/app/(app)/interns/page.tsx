import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import { GraduationCap, Plus } from "lucide-react";
import { and, asc, count, desc, eq, gte, isNotNull, lte, sql, type SQL } from "drizzle-orm";
import { can, canAny, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Department, Review, User, type Id, type Internship } from "@/lib/models";
import { namesFor } from "@/lib/people";
import { idParam, PAGE_SIZE, pageParam, param, sortParam, type SearchParams, type SortChoices } from "@/lib/query";
import { inList, jsonPath, nocase, searchAny } from "@/lib/sql";
import { STATUS, statusTone } from "@/lib/status";
import { addDays, fmtDate, todayKey } from "@/lib/time";
import { PersonCell } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusChip, Tag } from "@/components/ui/chip";
import { ChipFilters, ClearFilters, FilterBar, Pagination, SearchInput, SelectFilter, SortSelect } from "@/components/ui/filters";
import { EmptyState, PageBody, PageHeader, Progress, StatCard } from "@/components/ui/page";
import { EmptyRow, Td, Th, THead, TableWrap, Tr } from "@/components/ui/table";
import { internshipProgress } from "../staff/_lib/constants";

export const metadata: Metadata = { title: "Interns & trainees" };

const INTERN_STATUSES = Object.keys(STATUS.internship);

/** Row shape of the list query — the internship projection deliberately excludes stipend data. */
interface InternRow {
  _id: Id;
  name: string;
  photo: string | null;
  employeeId: string;
  personType: string;
  department: Id | null;
  designation: Id | null;
  internship?: Pick<Internship, "assignedRole" | "startDate" | "endDate" | "mentor" | "objectives" | "status" | "certificateStatus">;
}

/** The internship's status inside the JSON column (the path is inlined so select and group-by use the same expression). */
const internshipStatus = sql<string | null>`json_extract(${User.internship}, '$.status')`;

const SORTS = {
  name: { label: "Name A–Z", order: [asc(nocase(User.name)), asc(User._id)] },
  nameDesc: { label: "Name Z–A", order: [desc(nocase(User.name)), asc(User._id)] },
  started: { label: "Start date (newest)", order: [desc(jsonPath(User.internship, "startDate")), asc(nocase(User.name)), asc(User._id)] },
  ending: { label: "End date (earliest)", order: [asc(sql`coalesce(${jsonPath(User.internship, "endDate")}, '9999-12-31')`), asc(nocase(User.name)), asc(User._id)] },
  registered: { label: "Recently registered", order: [desc(User.createdAt), asc(User._id)] },
  employeeId: { label: "Employee ID", order: [asc(User.employeeId)] },
} satisfies SortChoices<SQL[]>;

export default async function InternsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;

  // Mentors see only their own mentees; reviewers, managers and staff viewers see everyone.
  const seeAll = canAny(user, ["staff.view", "interns.manage", "interns.review"]);
  const mentorOf = jsonPath<string | null>(User.internship, "mentor");
  if (!seeAll && (await db().$count(User, eq(mentorOf, user._id))) === 0) forbidden();
  const scope = and(inList(User.personType, ["intern", "trainee"]), seeAll ? undefined : eq(mentorOf, user._id));

  const today = todayKey();
  const page = pageParam(sp);
  const sort = sortParam(sp, SORTS);
  const type = param(sp, "type");
  const status = param(sp, "status");
  const mentorFilter = idParam(sp, "mentor");
  // Everything except the person-type chip, which is also what the per-type counts use.
  const typeFilterless = and(
    scope,
    INTERN_STATUSES.includes(status) ? eq(internshipStatus, status) : undefined,
    mentorFilter && seeAll ? eq(mentorOf, mentorFilter) : undefined,
    searchAny(param(sp, "q"), User.name, User.employeeId, User.email),
  );
  const filter = and(typeFilterless, type === "intern" || type === "trainee" ? eq(User.personType, type) : undefined);
  const [pageRows, total, typeCounts, statusCounts, runningIds, mentorRows, departments] = await Promise.all([
    db()
      .select({
        _id: User._id,
        name: User.name,
        photo: User.photo,
        employeeId: User.employeeId,
        personType: User.personType,
        department: User.department,
        designation: User.designation,
        internship: User.internship,
      })
      .from(User)
      .where(filter)
      .orderBy(...sort.order)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db().$count(User, filter),
    db().select({ personType: User.personType, n: count() }).from(User).where(typeFilterless).groupBy(User.personType),
    db().select({ status: internshipStatus, n: count() }).from(User).where(scope).groupBy(internshipStatus),
    db()
      .select({ _id: User._id })
      .from(User)
      .where(and(scope, inList(internshipStatus, ["active", "extended"]), lte(jsonPath(User.internship, "startDate"), addDays(today, -30)))),
    db().selectDistinct({ mentor: mentorOf }).from(User).where(and(scope, isNotNull(mentorOf))),
    db().select({ _id: Department._id, name: Department.name }).from(Department),
  ]);
  const mentorIds = mentorRows.flatMap((m) => (m.mentor ? [m.mentor] : []));
  // The stipend data in the internship column is dropped here: only what the list renders is kept.
  const rows: InternRow[] = pageRows.map(({ internship: i, ...r }) => ({
    ...r,
    internship: i
      ? { assignedRole: i.assignedRole, startDate: i.startDate, endDate: i.endDate, mentor: i.mentor, objectives: i.objectives, status: i.status, certificateStatus: i.certificateStatus }
      : undefined,
  }));

  const ids = rows.map((r) => r._id);
  const [reviewCounts, mentors, certificatesPending, recentlyReviewed] = await Promise.all([
    db()
      .select({ user: Review.user, n: count() })
      .from(Review)
      .where(and(inList(Review.user, ids), canAny(user, ["interns.manage", "interns.review"]) ? undefined : eq(Review.status, "shared")))
      .groupBy(Review.user),
    namesFor([...rows.map((r) => r.internship?.mentor), ...mentorIds]),
    db().$count(User, and(scope, inList(jsonPath(User.internship, "certificateStatus"), ["requested", "approved"]))),
    db()
      .selectDistinct({ user: Review.user })
      .from(Review)
      .where(and(inList(Review.user, runningIds.map((r) => r._id)), eq(Review.status, "shared"), gte(Review.date, addDays(today, -30)))),
  ]);

  const reviewsBy = new Map(reviewCounts.map((r) => [r.user, r.n]));
  const deptName = new Map(departments.map((d) => [d._id, d.name]));
  const byType = new Map(typeCounts.map((c) => [c.personType as string, c.n]));
  const byStatus = new Map(statusCounts.map((c) => [c.status, c.n]));
  const active = (byStatus.get("active") ?? 0) + (byStatus.get("extended") ?? 0);
  const dueForReview = runningIds.length - recentlyReviewed.length;
  const hasFilters = Object.entries(sp).some(([k, v]) => k !== "page" && k !== "sort" && v);
  const typeOptions = [
    { value: "", label: "All", count: (byType.get("intern") ?? 0) + (byType.get("trainee") ?? 0) },
    { value: "intern", label: "Interns", count: byType.get("intern") ?? 0 },
    { value: "trainee", label: "Trainees", count: byType.get("trainee") ?? 0 },
  ];

  return (
    <PageBody>
      <PageHeader
        overline="People"
        title="Interns & trainees"
        description={seeAll ? undefined : "Your mentees"}
        actions={
          can(user, "staff.create") ? (
            <ButtonLink href="/staff/new?type=intern" icon={<Plus className="size-4" />}>
              Register intern
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Active" value={active} sub={`${byStatus.get("registered") ?? 0} registered · ${byStatus.get("extended") ?? 0} extended`} />
        <StatCard label="Evaluations due" value={dueForReview} sub="No shared evaluation in 30 days" tone={dueForReview > 0 ? "alert" : "default"} />
        <StatCard label="Completed" value={byStatus.get("completed") ?? 0} sub="Internships closed" />
        <StatCard label="Certificates pending" value={certificatesPending} sub="Requested or awaiting issue" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-line-soft px-4 py-3.5">
          <ChipFilters param="type" options={typeOptions} />
          <FilterBar>
            <SearchInput placeholder="Name, email or ID" />
            <SelectFilter param="status" label="Internship status" allLabel="Any status" options={INTERN_STATUSES.map((s) => ({ value: s, label: STATUS.internship[s][0] }))} />
            {seeAll && <SelectFilter param="mentor" label="Mentor" allLabel="Any mentor" options={mentorIds.map((m) => ({ value: String(m), label: mentors.get(String(m)) ?? "Unknown" }))} />}
            <SortSelect options={sort.options} />
            <ClearFilters />
          </FilterBar>
        </div>
        <TableWrap phone={[1, 7]} tablet={[1, 3, 4, 7]}>
          <THead>
            <Th>Intern / trainee</Th>
            <Th>Role</Th>
            <Th>Mentor</Th>
            <Th className="w-52">Period</Th>
            <Th>Objectives</Th>
            <Th>Reviews</Th>
            <Th>Internship</Th>
            <Th>Certificate</Th>
          </THead>
          <tbody>
            {rows.length === 0 && (
              <EmptyRow colSpan={8}>
                <EmptyState
                  icon={<GraduationCap className="size-5" />}
                  title={hasFilters ? "No one matches these filters" : "No interns or trainees yet"}
                  description={hasFilters ? "Try a different search or clear the filters." : "Register an intern or trainee to start tracking their internship."}
                />
              </EmptyRow>
            )}
            {rows.map((r) => {
              const i = r.internship;
              const id = r._id;
              const progress = internshipProgress(i?.startDate, i?.endDate, today);
              const objectives = i?.objectives ?? [];
              const achieved = objectives.filter((o) => o.status === "achieved").length;
              const mentorName = i?.mentor ? mentors.get(i.mentor) : undefined;
              return (
                <Tr key={id}>
                  <Td>
                    <PersonCell name={r.name} sub={r.employeeId} photo={r.photo} href={`/interns/${id}`} />
                  </Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-ink">{i?.assignedRole ?? "—"}</span>
                      <Tag tone={statusTone("personType", r.personType)}>{r.personType === "intern" ? "Intern" : "Trainee"}</Tag>
                    </div>
                    {r.department && <div className="text-xs text-muted">{deptName.get(r.department)}</div>}
                  </Td>
                  <Td className={mentorName ? "text-ink-2" : "font-semibold text-danger"}>{mentorName ?? "Not assigned"}</Td>
                  <Td>
                    {i?.startDate && i.endDate ? (
                      <>
                        <div className="mb-1.5 text-xs whitespace-nowrap text-ink-2">
                          {fmtDate(i.startDate, "d MMM")} – {fmtDate(i.endDate, "d MMM yyyy")}
                        </div>
                        <Progress value={progress.pct} tone={progress.pct >= 100 ? "green" : "brand"} />
                      </>
                    ) : (
                      <span className="text-muted">Dates not set</span>
                    )}
                  </Td>
                  <Td className="tabular">{objectives.length ? `${achieved} / ${objectives.length}` : "—"}</Td>
                  <Td className="tabular">{reviewsBy.get(id) ?? 0}</Td>
                  <Td>
                    <StatusChip domain="internship" value={i?.status} />
                  </Td>
                  <Td>
                    <StatusChip domain="certificate" value={i?.certificateStatus ?? "none"} size="sm" />
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </TableWrap>
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
      </Card>
    </PageBody>
  );
}
