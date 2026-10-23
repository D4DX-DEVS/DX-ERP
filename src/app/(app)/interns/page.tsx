import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import { GraduationCap, Plus } from "lucide-react";
import { can, canAny, requireUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Types } from "mongoose";
import { Department, Review, User, type Internship } from "@/lib/models";
import { namesFor } from "@/lib/people";
import { idParam, PAGE_SIZE, pageParam, param, searchRegex, type SearchParams } from "@/lib/query";
import { STATUS, statusTone } from "@/lib/status";
import { addDays, fmtDate, todayKey } from "@/lib/time";
import { PersonCell } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusChip, Tag } from "@/components/ui/chip";
import { ChipFilters, ClearFilters, FilterBar, Pagination, SearchInput, SelectFilter } from "@/components/ui/filters";
import { EmptyState, PageBody, PageHeader, Progress, StatCard } from "@/components/ui/page";
import { EmptyRow, Td, Th, THead, TableWrap, Tr } from "@/components/ui/table";
import { internshipProgress } from "../staff/_lib/constants";

export const metadata: Metadata = { title: "Interns & trainees" };

const INTERN_STATUSES = Object.keys(STATUS.internship);

/** Row shape of the list query — the internship projection deliberately excludes stipend data. */
interface InternRow {
  _id: Types.ObjectId;
  name: string;
  photo?: string;
  employeeId: string;
  personType: string;
  department?: Types.ObjectId;
  designation?: Types.ObjectId;
  internship?: Pick<Internship, "assignedRole" | "startDate" | "endDate" | "mentor" | "objectives" | "status" | "certificateStatus">;
}

export default async function InternsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;
  await connectDB();

  // Mentors see only their own mentees; reviewers, managers and staff viewers see everyone.
  const seeAll = canAny(user, ["staff.view", "interns.manage", "interns.review"]);
  if (!seeAll && (await User.countDocuments({ "internship.mentor": user._id })) === 0) forbidden();
  const scope: Record<string, unknown> = { personType: { $in: ["intern", "trainee"] } };
  if (!seeAll) scope["internship.mentor"] = user._id;

  const today = todayKey();
  const page = pageParam(sp);
  const filter: Record<string, unknown> = { ...scope };
  const type = param(sp, "type");
  if (type === "intern" || type === "trainee") filter.personType = type;
  const status = param(sp, "status");
  if (INTERN_STATUSES.includes(status)) filter["internship.status"] = status;
  const mentorFilter = idParam(sp, "mentor");
  if (mentorFilter && seeAll) filter["internship.mentor"] = new Types.ObjectId(mentorFilter);
  const q = searchRegex(param(sp, "q"));
  if (q) filter.$or = [{ name: q }, { employeeId: q }, { email: q }];

  const typeFilterless = { ...filter, personType: scope.personType };
  const [rows, total, typeCounts, statusCounts, runningIds, mentorIds, departments] = await Promise.all([
    User.find(filter, {
      name: 1,
      photo: 1,
      employeeId: 1,
      personType: 1,
      department: 1,
      designation: 1,
      "internship.assignedRole": 1,
      "internship.startDate": 1,
      "internship.endDate": 1,
      "internship.mentor": 1,
      "internship.objectives": 1,
      "internship.status": 1,
      "internship.certificateStatus": 1,
    })
      .sort({ name: 1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean<InternRow[]>(),
    User.countDocuments(filter),
    User.aggregate<{ _id: string; n: number }>([{ $match: typeFilterless }, { $group: { _id: "$personType", n: { $sum: 1 } } }]),
    User.aggregate<{ _id: string; n: number }>([{ $match: scope }, { $group: { _id: "$internship.status", n: { $sum: 1 } } }]),
    User.find({ ...scope, "internship.status": { $in: ["active", "extended"] }, "internship.startDate": { $lte: addDays(today, -30) } }, { _id: 1 }).lean(),
    User.distinct("internship.mentor", scope),
    Department.find({}, { name: 1 }).lean(),
  ]);

  const ids = rows.map((r) => r._id);
  const [reviewCounts, mentors, certificatesPending, recentlyReviewed] = await Promise.all([
    Review.aggregate<{ _id: unknown; n: number }>([
      { $match: { user: { $in: ids }, ...(canAny(user, ["interns.manage", "interns.review"]) ? {} : { status: "shared" }) } },
      { $group: { _id: "$user", n: { $sum: 1 } } },
    ]),
    namesFor([...rows.map((r) => r.internship?.mentor), ...mentorIds]),
    User.countDocuments({ ...scope, "internship.certificateStatus": { $in: ["requested", "approved"] } }),
    Review.distinct("user", { user: { $in: runningIds.map((r) => r._id) }, status: "shared", date: { $gte: addDays(today, -30) } }),
  ]);

  const reviewsBy = new Map(reviewCounts.map((r) => [String(r._id), r.n]));
  const deptName = new Map(departments.map((d) => [d._id.toString(), d.name]));
  const byType = new Map(typeCounts.map((c) => [c._id, c.n]));
  const byStatus = new Map(statusCounts.map((c) => [c._id, c.n]));
  const active = (byStatus.get("active") ?? 0) + (byStatus.get("extended") ?? 0);
  const dueForReview = runningIds.length - recentlyReviewed.length;
  const hasFilters = Object.entries(sp).some(([k, v]) => k !== "page" && v);
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
              const id = r._id.toString();
              const progress = internshipProgress(i?.startDate, i?.endDate, today);
              const objectives = i?.objectives ?? [];
              const achieved = objectives.filter((o) => o.status === "achieved").length;
              const mentorName = i?.mentor ? mentors.get(i.mentor.toString()) : undefined;
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
                    {r.department && <div className="text-xs text-muted">{deptName.get(r.department.toString())}</div>}
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
