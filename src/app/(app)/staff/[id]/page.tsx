import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { FileText, GraduationCap, History, LayoutDashboard, Pencil, ShieldCheck, Wallet } from "lucide-react";
import { can, requireUser } from "@/lib/auth/session";
import { cn } from "@/lib/cn";
import { connectDB } from "@/lib/db";
import { Asset, Department, Designation, User } from "@/lib/models";
import { peopleOptions } from "@/lib/people";
import { param, type SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { statusTone } from "@/lib/status";
import { diffDays, fmtDate, todayKey } from "@/lib/time";
import { isObjectId } from "@/lib/validation";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { OptionChip, StatusChip, Tag } from "@/components/ui/chip";
import { Alert, PageBody } from "@/components/ui/page";
import { LinkTabs } from "@/components/ui/tabs";
import { DeletePersonButton } from "../_components/access-controls";
import { LifecycleActions, LifecycleProvider, type LifecycleProps } from "../_components/lifecycle-actions";
import { PhotoUpload } from "../_components/photo-upload";
import { tenureLabel } from "../_lib/constants";
import { personAccess } from "../_lib/people-access";
import { AccessTab } from "./_tabs/access";
import { DocumentsTab } from "./_tabs/documents";
import { HistoryTab } from "./_tabs/history";
import { OverviewTab } from "./_tabs/overview";
import { SalaryTab } from "./_tabs/salary";
import type { PersonRef } from "./_tabs/types";

export const metadata: Metadata = { title: "Staff profile" };

export default async function StaffProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  if (!isObjectId(id)) notFound();
  await connectDB();

  // Salary, salary history, bank details and the Google subject are never loaded here.
  const person = await User.findById(id).select("-salary -salaryHistory -bank -googleSub").lean();
  if (!person || person.personType === "admin") notFound();
  const access = personAccess(user, person);
  if (!access.canView) forbidden();

  const settings = await getSettings();
  const today = todayKey();
  const mentorId = person.internship?.mentor;
  const [department, designation, managerDoc, mentorDoc] = await Promise.all([
    person.department ? Department.findById(person.department, { name: 1 }).lean() : null,
    person.designation ? Designation.findById(person.designation, { name: 1 }).lean() : null,
    person.reportingManager ? User.findById(person.reportingManager, { name: 1, photo: 1, employeeId: 1 }).lean() : null,
    mentorId ? User.findById(mentorId, { name: 1, photo: 1, employeeId: 1 }).lean() : null,
  ]);
  const toRef = (u: { _id: { toString(): string }; name: string; photo?: string; employeeId: string } | null): PersonRef | undefined =>
    u ? { id: u._id.toString(), name: u.name, photo: u.photo, sub: u.employeeId } : undefined;
  const manager = toRef(managerDoc);
  const mentor = toRef(mentorDoc);

  const tabKeys = ["overview", "documents", ...(access.canConfidential ? ["salary"] : []), "history", ...(access.canManageUsers ? ["access"] : [])];
  const requested = param(sp, "tab");
  const tab = tabKeys.includes(requested) ? requested : "overview";
  const tabIcon = "size-[18px]";
  const tabMeta: Record<string, { label: string; icon: ReactNode }> = {
    overview: { label: "Overview", icon: <LayoutDashboard className={tabIcon} /> },
    documents: { label: "Documents", icon: <FileText className={tabIcon} /> },
    salary: { label: "Salary", icon: <Wallet className={tabIcon} /> },
    history: { label: "History", icon: <History className={tabIcon} /> },
    access: { label: "Access", icon: <ShieldCheck className={tabIcon} /> },
  };
  const tabItems = tabKeys.map((key) => ({ href: key === "overview" ? `/staff/${id}` : `/staff/${id}?tab=${key}`, ...tabMeta[key], active: tab === key }));

  let lifecycle: LifecycleProps | null = null;
  if (access.canEdit) {
    const [designations, departments, people, assets, reports, mentees] = await Promise.all([
      Designation.find({ active: true }, { name: 1 }).sort({ name: 1 }).lean(),
      Department.find({ active: true }, { name: 1 }).sort({ name: 1 }).lean(),
      peopleOptions(),
      Asset.countDocuments({ assignedTo: person._id, status: "assigned" }),
      User.countDocuments({ reportingManager: person._id }),
      User.countDocuments({ "internship.mentor": person._id }),
    ]);
    lifecycle = {
      userId: id,
      name: person.name,
      today,
      status: person.status,
      exitStage: person.exit?.stage ?? "none",
      lastWorkingDay: person.exit?.lastWorkingDay,
      currentDesignation: designation?.name,
      currentDepartment: department?.name,
      currentManager: manager?.name,
      designations: designations.map((d) => ({ id: d._id.toString(), name: d.name })),
      departments: departments.map((d) => ({ id: d._id.toString(), name: d.name })),
      people,
      statuses: settings.employmentStatuses.map((s) => ({ key: s.key, label: s.label, category: s.category })),
      counts: { assets, reports, mentees },
    };
  }

  const tabProps = { user, person, access, settings, today };
  const tenure = tenureLabel(person.joiningDate, today);
  const noticeDaysLeft = person.exit?.stage === "notice" && person.exit.lastWorkingDay ? diffDays(today, person.exit.lastWorkingDay) : null;
  const typeLabel = person.personType === "employee" ? "Employee" : person.personType === "trainee" ? "Trainee" : "Intern";

  const page = (
    <PageBody>
      <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
        {can(user, "staff.view") ? (
          <Link href="/staff" className="hover:text-brand-600">
            Staff
          </Link>
        ) : (
          <span>Staff</span>
        )}{" "}
        <span aria-hidden>/</span> {person.name}
      </nav>

      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-5">
          <PhotoUpload userId={id} name={person.name} photo={person.photo} canEdit={access.isSelf || access.canEdit} />
          <div className="flex min-w-0 flex-1 basis-72 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-display text-[24px] leading-tight font-semibold text-ink sm:text-[26px]">{person.name}</h1>
              <OptionChip options={settings.employmentStatuses} value={person.status} />
              <Tag tone={statusTone("personType", person.personType)}>{typeLabel}</Tag>
              <StatusChip domain="account" value={person.accountActive ? "active" : "inactive"} size="sm" />
            </div>
            <div className="text-sm text-ink-2">{[designation?.name, department?.name, person.employeeId].filter(Boolean).join(" · ")}</div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">
              {manager && (
                <span>
                  Reports to{" "}
                  <Link href={`/staff/${manager.id}`} className="font-semibold text-brand-600 hover:underline">
                    {manager.name}
                  </Link>
                </span>
              )}
              {person.joiningDate && (
                <span>
                  Joined {fmtDate(person.joiningDate)}
                  {tenure ? ` · ${tenure}` : ""}
                </span>
              )}
              <a href={`mailto:${person.email}`} className="hover:text-brand-600">
                {person.email}
              </a>
              {person.phone && <span>{person.phone}</span>}
            </div>
          </div>
          {/* Editors see up to four actions: on phones the secondary ones show only their icon so they stay on one row. */}
          <div className="flex flex-wrap items-center gap-2">
            {access.internLike && (
              <ButtonLink
                href={`/interns/${id}`}
                variant="secondary"
                icon={<GraduationCap className={cn("size-4", access.canEdit && "sm:hidden")} aria-hidden />}
                className={cn(access.canEdit && "max-sm:w-9 max-sm:px-0")}
              >
                <span className={cn(access.canEdit && "max-sm:sr-only")}>{person.personType === "intern" ? "Internship" : "Traineeship"}</span>
              </ButtonLink>
            )}
            {access.canEdit && (
              <ButtonLink href={`/staff/${id}/edit`} variant="secondary" icon={<Pencil className="size-4" aria-hidden />} className="max-sm:w-9 max-sm:px-0">
                <span className="max-sm:sr-only">Edit</span>
              </ButtonLink>
            )}
            {lifecycle && <LifecycleActions />}
            {can(user, "staff.delete") && !access.isSelf && <DeletePersonButton userId={id} name={person.name} />}
          </div>
        </div>
      </Card>

      {person.exit?.stage === "notice" && (
        <Alert tone="warning" title="Notice period.">
          Last working day {fmtDate(person.exit.lastWorkingDay)}
          {noticeDaysLeft !== null ? (noticeDaysLeft >= 0 ? ` — ${noticeDaysLeft} ${noticeDaysLeft === 1 ? "day" : "days"} left.` : ` — ${Math.abs(noticeDaysLeft)} days ago; complete the exit.`) : "."}
        </Alert>
      )}
      {person.exit?.stage === "completed" && (
        <Alert tone="info" title="Exit completed.">
          Left on {fmtDate(person.exit.lastWorkingDay)}. Login access is revoked.
        </Alert>
      )}

      <LinkTabs items={tabItems} />

      {tab === "overview" && <OverviewTab {...tabProps} department={department?.name} designation={designation?.name} manager={manager} mentor={mentor} people={lifecycle?.people} />}
      {tab === "documents" && <DocumentsTab {...tabProps} />}
      {tab === "salary" && <SalaryTab {...tabProps} />}
      {tab === "history" && <HistoryTab {...tabProps} />}
      {tab === "access" && <AccessTab {...tabProps} />}
    </PageBody>
  );
  // One set of lifecycle dialogs serves the header menu and the inline ✎ buttons in the tabs.
  return lifecycle ? <LifecycleProvider {...lifecycle}>{page}</LifecycleProvider> : page;
}
