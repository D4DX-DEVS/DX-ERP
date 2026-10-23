import Link from "next/link";
import { can } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { inr } from "@/lib/format";
import { LearningResource, Review, Task } from "@/lib/models";
import { fmtDate } from "@/lib/time";
import { PersonCell } from "@/components/ui/avatar";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { StatusChip, Tag } from "@/components/ui/chip";
import { Progress } from "@/components/ui/page";
import { visibleResourceFilter } from "../../../learning/_lib/visibility";
import { internshipProgress, STIPEND_PERIODS } from "../../../staff/_lib/constants";
import { ObjectivesPanel } from "../../_components/objectives-panel";
import type { InternTabProps } from "./types";

export async function OverviewTab({ user, target, access, settings, today, department, designation, mentor, manager }: InternTabProps) {
  await connectDB();
  const internship = target.internship;
  const progress = internshipProgress(internship?.startDate, internship?.endDate, today);
  const objectives = internship?.objectives ?? [];
  const achieved = objectives.filter((o) => o.status === "achieved").length;
  const doneKeys = settings.taskStatuses.filter((s) => s.category === "done").map((s) => s.key);

  const [sharedReviews, learningTotal, learningDone, tasksTotal, tasksDone] = await Promise.all([
    Review.countDocuments({ user: target._id, status: "shared" }),
    LearningResource.countDocuments(visibleResourceFilter({ id: target._id, personType: target.personType, department: target.department })),
    LearningResource.countDocuments({ ...visibleResourceFilter({ id: target._id, personType: target.personType, department: target.department }), "completions.user": target._id }),
    access.canSeeTasks ? Task.countDocuments({ assignees: target._id }) : Promise.resolve(0),
    access.canSeeTasks ? Task.countDocuments({ assignees: target._id, status: { $in: doneKeys } }) : Promise.resolve(0),
  ]);

  const weeks = Math.max(1, Math.ceil(progress.total / 7));
  const week = Math.min(weeks, Math.floor(progress.elapsed / 7) + 1);
  const stipend = internship?.stipend;
  const objectiveViews = objectives.map((o) => ({ id: o._id?.toString() ?? o.text, text: o.text, status: o.status }));

  return (
    <div className="grid items-start gap-4 lg:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
        <Card>
          <CardHeader title="Internship progress" />
          <CardBody className="flex flex-col gap-3">
            {internship?.startDate && internship.endDate ? (
              <>
                <div className="flex flex-wrap justify-between gap-2 text-[13px]">
                  <span>
                    <span className="text-muted">Started</span> <strong>{fmtDate(internship.startDate)}</strong>
                  </span>
                  <span>
                    <span className="text-muted">Ends</span> <strong>{fmtDate(internship.endDate)}</strong>
                  </span>
                </div>
                <Progress value={progress.pct} tone={progress.pct >= 100 ? "green" : "brand"} className="h-2.5" />
                <div className="text-[13px] text-ink-2">
                  {!progress.started
                    ? `Starts ${fmtDate(internship.startDate)}`
                    : progress.finished
                      ? "Planned period is over"
                      : `Week ${week} of ${weeks} · ${progress.daysLeft} ${progress.daysLeft === 1 ? "day" : "days"} to go`}
                </div>
              </>
            ) : (
              <p className="text-[13px] text-muted">Start and end dates have not been set.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Objectives" subtitle={`${achieved} of ${objectives.length} achieved`} />
          <CardBody>
            <ObjectivesPanel userId={target._id.toString()} objectives={objectiveViews} canEdit={access.canRun && internship?.status !== "completed" && internship?.status !== "terminated"} />
          </CardBody>
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardHeader title="Mentor" />
          <CardBody className="flex flex-col gap-3">
            {mentor ? (
              <PersonCell name={mentor.name} sub={mentor.sub} photo={mentor.photo} href={`/staff/${mentor.id}`} />
            ) : (
              <p className="text-[13px] text-muted">No mentor assigned yet.</p>
            )}
            {manager && (
              <div>
                <div className="mb-1 text-xs font-medium text-muted">Supervisor</div>
                <PersonCell name={manager.name} sub={manager.sub} photo={manager.photo} href={`/staff/${manager.id}`} />
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DetailList
              columns={1}
              items={[
                { label: "Department", value: department ?? "—" },
                { label: "Designation", value: designation ?? "—" },
                { label: "Assigned role", value: internship?.assignedRole || "—" },
                { label: "College", value: internship?.college || "—" },
                { label: "Course", value: internship?.course || "—" },
                { label: "Status", value: internship ? <StatusChip domain="internship" value={internship.status} /> : "—" },
                { label: "Certificate", value: internship ? <StatusChip domain="certificate" value={internship.certificateStatus} /> : "—" },
              ]}
            />
          </CardBody>
        </Card>
        {access.canSeeStipend && stipend && (
          <Card>
            <CardHeader
              title="Stipend"
              action={
                <Tag tone="gray" className="bg-navy text-white">
                  Restricted
                </Tag>
              }
            />
            <CardBody className="flex flex-col gap-2 text-[13px]">
              {stipend.eligible ? (
                <div className="text-ink">
                  <span className="font-display text-xl font-semibold tabular">{inr(stipend.amount)}</span>{" "}
                  <span className="text-muted">{STIPEND_PERIODS.find((p) => p.value === stipend.period)?.label.toLowerCase()}</span>
                </div>
              ) : (
                <p className="text-muted">Not eligible for a stipend.</p>
              )}
              {can(user, "staff.confidential") && (
                <Link href={`/staff/${target._id}?tab=salary`} className="font-semibold text-brand-600 hover:underline">
                  Revision history →
                </Link>
              )}
            </CardBody>
          </Card>
        )}
        <Card>
          <CardHeader title="At a glance" />
          <CardBody className="flex flex-col gap-2 text-[13px]">
            {[
              ["Objectives achieved", `${achieved} of ${objectives.length}`],
              ["Evaluations shared", String(sharedReviews)],
              ...(access.canSeeTasks ? [["Tasks done", `${tasksDone} of ${tasksTotal}`]] : []),
              ["Learning completed", `${learningDone} of ${learningTotal}`],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3">
                <span className="text-muted">{k}</span>
                <strong className="tabular">{v}</strong>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
