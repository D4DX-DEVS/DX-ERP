import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { Award, CheckSquare, LayoutDashboard, Star } from "lucide-react";
import { can, requireUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { inr } from "@/lib/format";
import { Department, Designation, User } from "@/lib/models";
import { param, type SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { statusTone } from "@/lib/status";
import { fmtDate, todayKey } from "@/lib/time";
import { isObjectId } from "@/lib/validation";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusChip, Tag } from "@/components/ui/chip";
import { PageBody } from "@/components/ui/page";
import { LinkTabs } from "@/components/ui/tabs";
import { internAccess } from "../_lib/access";
import { CompletionTab } from "./_tabs/completion";
import { EvaluationsTab } from "./_tabs/evaluations";
import { OverviewTab } from "./_tabs/overview";
import { TasksTab } from "./_tabs/tasks";
import type { PersonRef } from "./_tabs/types";

export const metadata: Metadata = { title: "Intern" };

export default async function InternPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  if (!isObjectId(id)) notFound();
  await connectDB();

  const target = await User.findById(id).select("-salary -salaryHistory -bank -googleSub").lean();
  if (!target || (target.personType !== "intern" && target.personType !== "trainee")) notFound();
  const access = internAccess(user, target);
  if (!access.canView) forbidden();

  const settings = await getSettings();
  const today = todayKey();
  const [department, designation, mentorDoc, managerDoc] = await Promise.all([
    target.department ? Department.findById(target.department, { name: 1 }).lean() : null,
    target.designation ? Designation.findById(target.designation, { name: 1 }).lean() : null,
    target.internship?.mentor ? User.findById(target.internship.mentor, { name: 1, photo: 1, employeeId: 1 }).lean() : null,
    target.reportingManager ? User.findById(target.reportingManager, { name: 1, photo: 1, employeeId: 1 }).lean() : null,
  ]);
  const toRef = (u: { _id: { toString(): string }; name: string; photo?: string; employeeId: string } | null): PersonRef | undefined =>
    u ? { id: u._id.toString(), name: u.name, photo: u.photo, sub: u.employeeId } : undefined;
  const mentor = toRef(mentorDoc);
  const manager = toRef(managerDoc);

  const keys = ["overview", ...(access.canSeeTasks ? ["tasks"] : []), ...(access.canEvaluate || access.isSelf || access.isManager ? ["evaluations"] : []), "completion"];
  const tabIcon = "size-[18px]";
  const tabMeta: Record<string, { label: string; icon: ReactNode }> = {
    overview: { label: "Overview", icon: <LayoutDashboard className={tabIcon} /> },
    tasks: { label: "Tasks & submissions", icon: <CheckSquare className={tabIcon} /> },
    evaluations: { label: "Evaluations", icon: <Star className={tabIcon} /> },
    completion: { label: "Completion", icon: <Award className={tabIcon} /> },
  };
  const requested = param(sp, "tab");
  const tab = keys.includes(requested) ? requested : "overview";
  const tabs = keys.map((k) => ({ href: k === "overview" ? `/interns/${id}` : `/interns/${id}?tab=${k}`, ...tabMeta[k], active: tab === k }));

  const internship = target.internship;
  const stipend = internship?.stipend;
  const running = internship ? ["registered", "active", "extended"].includes(internship.status) : false;
  const typeLabel = target.personType === "intern" ? "Intern" : "Trainee";
  const canOpenStaff = access.isSelf || can(user, "staff.view") || access.isMentor || access.isManager;
  const tabProps = { user, target, access, settings, today, department: department?.name, designation: designation?.name, mentor, manager };

  return (
    <PageBody>
      <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
        {access.isSelf ? (
          <span>My internship</span>
        ) : (
          <Link href="/interns" className="hover:text-brand-600">
            Interns &amp; trainees
          </Link>
        )}{" "}
        <span aria-hidden>/</span> {target.name}
      </nav>

      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-5">
          <Avatar name={target.name} src={target.photo} size="xl" />
          <div className="flex min-w-0 flex-1 basis-72 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-display text-[24px] leading-tight font-semibold text-ink">{target.name}</h1>
              <Tag tone={statusTone("personType", target.personType)}>{typeLabel}</Tag>
              {internship && <StatusChip domain="internship" value={internship.status} />}
              {internship && internship.certificateStatus !== "none" && <StatusChip domain="certificate" value={internship.certificateStatus} size="sm" />}
            </div>
            <div className="text-sm text-ink-2">
              {[internship?.assignedRole ?? designation?.name, department?.name, target.employeeId, [internship?.college, internship?.course].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-muted">
              <span>
                Mentor <strong className="font-semibold text-ink">{mentor?.name ?? "Not assigned"}</strong>
              </span>
              {manager && (
                <span>
                  Supervisor <strong className="font-semibold text-ink">{manager.name}</strong>
                </span>
              )}
              {internship?.startDate && (
                <span>
                  {fmtDate(internship.startDate)} – {fmtDate(internship.endDate)}
                </span>
              )}
              {access.canSeeStipend && stipend?.eligible && (
                <span className="flex items-center gap-1.5">
                  Stipend {inr(stipend.amount)}
                  {stipend.period === "monthly" ? " / month" : ""}
                  <Tag tone="gray" className="bg-navy text-white">
                    HR · Finance
                  </Tag>
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canOpenStaff && (
              <ButtonLink href={access.isSelf ? "/profile" : `/staff/${id}`} variant="secondary">
                {access.isSelf ? "My profile" : "Staff record"}
              </ButtonLink>
            )}
            {running && access.canRun && <ButtonLink href={`/interns/${id}?tab=completion`}>Complete internship</ButtonLink>}
          </div>
        </div>
      </Card>

      <LinkTabs items={tabs} />

      {tab === "overview" && <OverviewTab {...tabProps} />}
      {tab === "tasks" && <TasksTab {...tabProps} />}
      {tab === "evaluations" && <EvaluationsTab {...tabProps} />}
      {tab === "completion" && <CompletionTab {...tabProps} />}
    </PageBody>
  );
}
