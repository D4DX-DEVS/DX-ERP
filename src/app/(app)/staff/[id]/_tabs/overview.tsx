import Link from "next/link";
import { Laptop, Users } from "lucide-react";
import { and, asc, eq } from "drizzle-orm";
import { can } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Asset, User } from "@/lib/models";
import { inList } from "@/lib/sql";
import { fmtDate } from "@/lib/time";
import { PersonCell } from "@/components/ui/avatar";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { Chip, OptionChip, StatusChip } from "@/components/ui/chip";
import { Progress } from "@/components/ui/page";
import type { PickerOption } from "@/components/ui/people-picker";
import { LifecycleEditButton } from "../../_components/lifecycle-actions";
import { OnboardingChecklist } from "../../_components/onboarding-checklist";
import { ProfileCompletionCard } from "../../_components/profile-completion";
import { SectionEditButton, SelfContactEditButton, type SectionPerson } from "../../_components/section-edit";
import {
  AUTO_ONBOARDING_KEY,
  contractLengthLabel,
  contractStatus,
  employmentTypeLabel,
  genderLabel,
  internshipProgress,
  ONBOARDING_STEPS,
  tenureLabel,
  whatsappLink,
} from "../../_lib/constants";
import type { ProfileCompletion } from "../../_lib/completion";
import type { PersonRef, TabProps } from "./types";

function formatAddress(a: TabProps["person"]["address"]): string {
  if (!a) return "";
  return [a.line1, a.line2, a.city, [a.state, a.postalCode].filter(Boolean).join(" "), a.country].filter(Boolean).join(", ");
}

export async function OverviewTab({
  user,
  person,
  access,
  settings,
  today,
  department,
  designation,
  manager,
  mentor,
  people,
  completion,
}: TabProps & { department?: string; designation?: string; manager?: PersonRef; mentor?: PersonRef; people?: PickerOption[]; completion?: ProfileCompletion }) {
  const id = person._id;
  const showAssets = access.canSeePersonal || can(user, "assets.view");
  const loadAssets = async () =>
    showAssets
      ? db()
          .select({ _id: Asset._id, assetNo: Asset.assetNo, name: Asset.name, category: Asset.category, condition: Asset.condition, history: Asset.history })
          .from(Asset)
          .where(and(eq(Asset.assignedTo, id), eq(Asset.status, "assigned")))
          .orderBy(asc(Asset.name))
      : [];
  const [reports, assets] = await Promise.all([
    db()
      .select({ _id: User._id, name: User.name, photo: User.photo, employeeId: User.employeeId })
      .from(User)
      .where(and(eq(User.reportingManager, id), inList(User.personType, ["employee", "trainee", "intern"])))
      .orderBy(asc(User.name))
      .limit(9),
    loadAssets(),
  ]);

  const steps = ONBOARDING_STEPS.map((s) => {
    const stored = person.onboarding?.find((o) => o.key === s.key);
    return { key: s.key, label: s.label, hint: s.hint, done: Boolean(stored?.done), doneOn: stored?.doneAt ? fmtDate(stored.doneAt) : undefined, auto: s.key === AUTO_ONBOARDING_KEY };
  });

  const tenure = tenureLabel(person.joiningDate, today);
  const internship = person.internship;
  const progress = internship ? internshipProgress(internship.startDate, internship.endDate, today) : null;
  const address = formatAddress(person.address);
  const ec = person.emergencyContact;
  const emergency = ec ? [ec.name, ec.relation, ec.phone].filter(Boolean).join(" · ") : "";
  const contract = contractStatus(person.contractStart, person.contractEnd, today);
  const contractLength = contractLengthLabel(person.contractStart, person.contractEnd);
  const wa = whatsappLink(person.whatsapp);

  // Values with their own lifecycle form get an inline ✎ (rendered only for staff.edit, via LifecycleProvider).
  const withEdit = (value: React.ReactNode, kind: "designation" | "department" | "status", label: string) => (
    <span className="inline-flex items-center gap-1">
      {value}
      <LifecycleEditButton kind={kind} label={label} />
    </span>
  );
  const items = [
    { label: "Work email", value: <a href={`mailto:${person.email}`} className="text-brand-600 hover:underline">{person.email}</a> },
    { label: "Phone", value: person.phone || "—" },
    {
      label: "WhatsApp",
      value: person.whatsapp ? (
        wa ? (
          <a href={wa} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">
            {person.whatsapp}
          </a>
        ) : (
          person.whatsapp
        )
      ) : (
        "—"
      ),
    },
    { label: "Department", value: withEdit(department ?? "—", "department", "Transfer department") },
    { label: "Designation", value: withEdit(designation ?? "—", "designation", "Change designation / promote") },
    { label: "Team", value: person.team || "—" },
    { label: "Employment type", value: employmentTypeLabel(person.employmentType) },
    { label: "Joining date", value: person.joiningDate ? `${fmtDate(person.joiningDate)}${tenure ? ` · ${tenure}` : ""}` : "—" },
    {
      label: "Contract period",
      full: true,
      value: contract ? (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            {fmtDate(person.contractStart)} – {person.contractEnd ? fmtDate(person.contractEnd) : "open-ended"}
            {contractLength ? ` · ${contractLength}` : ""}
          </span>
          <Chip tone={contract.tone} size="sm">
            {contract.label}
          </Chip>
        </span>
      ) : (
        "—"
      ),
    },
    { label: "Status", value: withEdit(<OptionChip options={settings.employmentStatuses} value={person.status} />, "status", "Change employment status") },
    ...(person.exit && person.exit.stage !== "none"
      ? [
          { label: "Resignation date", value: fmtDate(person.exit.resignationDate) },
          { label: person.exit.stage === "completed" ? "Exit date" : "Last working day", value: fmtDate(person.exit.lastWorkingDay) },
          ...(person.exit.reason && access.canSeePersonal ? [{ label: "Resignation reason", value: person.exit.reason, full: true }] : []),
        ]
      : []),
  ];
  const personal = [
    { label: "Date of birth", value: fmtDate(person.dob) },
    { label: "Gender", value: genderLabel(person.gender) },
    { label: "Blood group", value: person.bloodGroup || "—" },
    { label: "Personal email", value: person.personalEmail || "—" },
    { label: "Address", value: address || "—", full: true },
    { label: "Emergency contact", value: emergency || "—", full: true },
  ];

  const sectionPerson: SectionPerson = {
    id,
    name: person.name,
    email: person.email,
    phone: person.phone ?? undefined,
    whatsapp: person.whatsapp ?? undefined,
    personalEmail: person.personalEmail ?? undefined,
    dob: person.dob ?? undefined,
    gender: person.gender ?? undefined,
    bloodGroup: person.bloodGroup ?? undefined,
    addrLine1: person.address?.line1,
    addrLine2: person.address?.line2,
    city: person.address?.city,
    state: person.address?.state,
    postalCode: person.address?.postalCode,
    country: person.address?.country,
    emergencyName: ec?.name,
    emergencyRelation: ec?.relation,
    emergencyPhone: ec?.phone,
    employmentType: person.employmentType,
    team: person.team ?? undefined,
    joiningDate: person.joiningDate ?? undefined,
    contractStart: person.contractStart ?? undefined,
    contractEnd: person.contractEnd ?? undefined,
    internship: internship
      ? { startDate: internship.startDate, endDate: internship.endDate, college: internship.college, course: internship.course, assignedRole: internship.assignedRole, mentor: internship.mentor }
      : undefined,
  };
  const canEmail = can(user, "users.manage");
  const selfEdit = access.isSelf && !access.canEdit && !user.isSuperAdmin ? <SelfContactEditButton person={sectionPerson} /> : undefined;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
        <Card>
          <CardHeader
            title="Employment & contact"
            action={access.canEdit ? <SectionEditButton section="employment" person={sectionPerson} today={today} canEmail={canEmail} /> : selfEdit}
          />
          <CardBody>
            <DetailList items={items} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Personal details"
            subtitle={access.canSeePersonal ? undefined : "Visible to the person, their manager and HR"}
            action={access.canEdit ? <SectionEditButton section="personal" person={sectionPerson} today={today} /> : selfEdit}
          />
          <CardBody>
            {access.canSeePersonal ? <DetailList items={personal} /> : <p className="text-[13px] text-muted">These details are restricted.</p>}
          </CardBody>
        </Card>
        {access.canSeePersonal && (
          <Card>
            <CardHeader title="Onboarding checklist" subtitle={access.canEdit ? "Tick steps as they are completed. Some steps complete automatically." : undefined} />
            <CardBody>
              <OnboardingChecklist userId={id} steps={steps} canEdit={access.canEdit} />
            </CardBody>
          </Card>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {completion && (
          <ProfileCompletionCard
            completion={completion}
            links={
              access.canSeeRecords
                ? {
                    documents: `/staff/${id}?tab=documents`,
                    education: `/staff/${id}?tab=documents#education`,
                    ...(access.canConfidential || access.isSelf ? { bank: `/staff/${id}?tab=documents#bank` } : {}),
                  }
                : {}
            }
          />
        )}
        {internship && progress && (
          <Card>
            <CardHeader
              title="Internship"
              href={`/interns/${id}`}
              hrefLabel="Open"
              action={access.canEdit ? <SectionEditButton section="internship" person={sectionPerson} today={today} people={people} /> : undefined}
            />
            <CardBody className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2 text-[13px]">
                <StatusChip domain="internship" value={internship.status} />
                <span className="text-muted tabular">{progress.pct}% elapsed</span>
              </div>
              <Progress value={progress.pct} tone={progress.pct >= 100 ? "green" : "brand"} />
              <div className="text-[13px] text-ink-2">
                {fmtDate(internship.startDate)} – {fmtDate(internship.endDate)}
              </div>
              {mentor && (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted">Mentor</div>
                  <PersonCell name={mentor.name} sub={mentor.sub} photo={mentor.photo} href={`/staff/${mentor.id}`} />
                </div>
              )}
            </CardBody>
          </Card>
        )}
        <Card>
          <CardHeader title="Reporting" action={<LifecycleEditButton kind="manager" label="Change reporting manager" />} />
          <CardBody className="flex flex-col gap-4">
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted">Reports to</div>
              {manager ? <PersonCell name={manager.name} sub={manager.sub} photo={manager.photo} href={`/staff/${manager.id}`} /> : <p className="text-[13px] text-muted">No reporting manager assigned.</p>}
            </div>
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted">
                <Users className="size-3.5" /> Direct reports
              </div>
              {reports.length === 0 ? (
                <p className="text-[13px] text-muted">None.</p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {reports.slice(0, 8).map((r) => (
                    <li key={r._id} data-href={`/staff/${r._id}`} className="cursor-pointer">
                      <PersonCell name={r.name} sub={r.employeeId} photo={r.photo} href={`/staff/${r._id}`} />
                    </li>
                  ))}
                  {reports.length > 8 && (
                    <li className="text-xs text-muted">
                      and more —{" "}
                      <Link href={`/staff?q=${encodeURIComponent(person.name)}`} className="font-semibold text-brand-600">
                        search the directory
                      </Link>
                    </li>
                  )}
                </ul>
              )}
            </div>
          </CardBody>
        </Card>
        {showAssets && (
          <Card>
            <CardHeader title="Assets assigned" />
            <CardBody>
              {assets.length === 0 ? (
                <p className="text-[13px] text-muted">No assets assigned.</p>
              ) : (
                <ul className="flex flex-col">
                  {assets.map((a) => {
                    const issued = [...(a.history ?? [])].reverse().find((h) => h.user === id);
                    const canOpen = can(user, "assets.view");
                    return (
                      <li key={a._id} data-href={canOpen ? `/assets/${a._id}` : undefined} className={`flex items-start gap-3 border-t border-line-soft py-2.5 first:border-t-0 first:pt-0${canOpen ? " cursor-pointer" : ""}`}>
                        <Laptop className="mt-0.5 size-[18px] shrink-0 text-muted" aria-hidden />
                        <div className="min-w-0 flex-1">
                          {canOpen ? (
                            <Link href={`/assets/${a._id}`} className="block text-sm font-semibold break-words text-ink hover:text-brand-600">
                              {a.name}
                            </Link>
                          ) : (
                            <span className="block text-sm font-semibold break-words text-ink">{a.name}</span>
                          )}
                          <span className="text-xs text-muted">
                            {a.assetNo}
                            {issued ? ` · issued ${fmtDate(issued.at)}` : ""}
                          </span>
                        </div>
                        <StatusChip domain="assetCondition" value={a.condition} size="sm" />
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
