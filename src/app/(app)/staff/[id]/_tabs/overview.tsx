import Link from "next/link";
import { Laptop, Users } from "lucide-react";
import { can } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Asset, User } from "@/lib/models";
import { fmtDate } from "@/lib/time";
import { PersonCell } from "@/components/ui/avatar";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { OptionChip, StatusChip } from "@/components/ui/chip";
import { Progress } from "@/components/ui/page";
import type { PickerOption } from "@/components/ui/people-picker";
import { LifecycleEditButton } from "../../_components/lifecycle-actions";
import { OnboardingChecklist } from "../../_components/onboarding-checklist";
import { SectionEditButton, SelfContactEditButton, type SectionPerson } from "../../_components/section-edit";
import { AUTO_ONBOARDING_KEY, employmentTypeLabel, genderLabel, internshipProgress, ONBOARDING_STEPS, tenureLabel } from "../../_lib/constants";
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
}: TabProps & { department?: string; designation?: string; manager?: PersonRef; mentor?: PersonRef; people?: PickerOption[] }) {
  await connectDB();
  const id = person._id;
  const showAssets = access.canSeePersonal || can(user, "assets.view");
  const [reports, assets] = await Promise.all([
    User.find({ reportingManager: id, personType: { $in: ["employee", "trainee", "intern"] } }, { name: 1, photo: 1, designation: 1, status: 1, employeeId: 1 })
      .sort({ name: 1 })
      .limit(9)
      .lean(),
    showAssets ? Asset.find({ assignedTo: id, status: "assigned" }, { assetNo: 1, name: 1, category: 1, condition: 1, history: 1 }).sort({ name: 1 }).lean() : Promise.resolve([]),
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
    { label: "Department", value: withEdit(department ?? "—", "department", "Transfer department") },
    { label: "Designation", value: withEdit(designation ?? "—", "designation", "Change designation / promote") },
    { label: "Team", value: person.team || "—" },
    { label: "Employment type", value: employmentTypeLabel(person.employmentType) },
    { label: "Joining date", value: person.joiningDate ? `${fmtDate(person.joiningDate)}${tenure ? ` · ${tenure}` : ""}` : "—" },
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
    id: id.toString(),
    name: person.name,
    email: person.email,
    phone: person.phone,
    personalEmail: person.personalEmail,
    dob: person.dob,
    gender: person.gender,
    bloodGroup: person.bloodGroup,
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
    team: person.team,
    joiningDate: person.joiningDate,
    internship: internship
      ? { startDate: internship.startDate, endDate: internship.endDate, college: internship.college, course: internship.course, assignedRole: internship.assignedRole, mentor: internship.mentor?.toString() }
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
              <OnboardingChecklist userId={id.toString()} steps={steps} canEdit={access.canEdit} />
            </CardBody>
          </Card>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
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
                    <li key={r._id.toString()}>
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
                    const issued = [...(a.history ?? [])].reverse().find((h) => h.user?.toString() === id.toString());
                    return (
                      <li key={a._id.toString()} className="flex items-start gap-3 border-t border-line-soft py-2.5 first:border-t-0 first:pt-0">
                        <Laptop className="mt-0.5 size-[18px] shrink-0 text-muted" aria-hidden />
                        <div className="min-w-0 flex-1">
                          {can(user, "assets.view") ? (
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
