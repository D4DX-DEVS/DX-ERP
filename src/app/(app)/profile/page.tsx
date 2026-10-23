import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Laptop } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Asset, Department, Designation, User } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { statusTone } from "@/lib/status";
import { fmtDate, fmtDateTime, todayKey } from "@/lib/time";
import { PersonCell } from "@/components/ui/avatar";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { OptionChip, StatusChip, Tag } from "@/components/ui/chip";
import { PageBody, PageHeader } from "@/components/ui/page";
import { DocumentsPanel } from "../staff/_components/documents-panel";
import { PhotoUpload } from "../staff/_components/photo-upload";
import { SessionList } from "../staff/_components/session-list";
import { employmentTypeLabel, tenureLabel } from "../staff/_lib/constants";
import { categoriesFor } from "../staff/_lib/documents";
import { loadDocuments } from "../staff/_lib/documents-data";
import { loadSessions } from "../staff/_lib/sessions";
import { ProfileForm } from "./profile-form";
import { revokeMySession, signOutOtherSessions } from "./actions";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfilePage() {
  const user = await requireUser();
  await connectDB();
  const me = await User.findById(user._id).select("-salary -salaryHistory -bank -googleSub").lean();
  if (!me) notFound();
  const sessions = await loadSessions(user._id, user.sid);
  const sessionsCard = (
    <Card>
      <CardHeader title="Active sessions" subtitle="Devices currently signed in to your account." />
      <CardBody>
        <SessionList sessions={sessions} revoke={revokeMySession} revokeAll={signOutOtherSessions} revokeAllLabel="Sign out all other sessions" />
      </CardBody>
    </Card>
  );

  // The super admin account has no employment record — only account info and sessions.
  if (user.isSuperAdmin || me.personType === "admin") {
    return (
      <PageBody>
        <PageHeader overline="Account" title="My profile" />
        <div className="grid items-start gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader title="Account" />
            <CardBody className="flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <PhotoUpload userId={user.id} name={me.name} photo={me.photo} canEdit size="lg" />
                <div className="min-w-0">
                  <div className="truncate font-display text-lg font-semibold text-ink">{me.name}</div>
                  <Tag tone="gray">Super Admin</Tag>
                </div>
              </div>
              <DetailList
                columns={1}
                items={[
                  { label: "Sign-in email", value: me.email },
                  { label: "Role", value: user.roleName },
                  { label: "Last sign-in", value: me.lastLoginAt ? fmtDateTime(me.lastLoginAt) : "—" },
                ]}
              />
            </CardBody>
          </Card>
          <div className="lg:col-span-2">{sessionsCard}</div>
        </div>
      </PageBody>
    );
  }

  const settings = await getSettings();
  const today = todayKey();
  const [department, designation, manager, mentor, assets, docs] = await Promise.all([
    me.department ? Department.findById(me.department, { name: 1 }).lean() : null,
    me.designation ? Designation.findById(me.designation, { name: 1 }).lean() : null,
    me.reportingManager ? User.findById(me.reportingManager, { name: 1, photo: 1, employeeId: 1 }).lean() : null,
    me.internship?.mentor ? User.findById(me.internship.mentor, { name: 1, photo: 1, employeeId: 1 }).lean() : null,
    Asset.find({ assignedTo: me._id, status: "assigned" }, { assetNo: 1, name: 1, condition: 1, history: 1 }).sort({ name: 1 }).lean(),
    loadDocuments({ personId: user.id, personType: me.personType, includeConfidential: true, settings, today }),
  ]);
  const tenure = tenureLabel(me.joiningDate, today);
  const typeLabel = me.personType === "employee" ? "Employee" : me.personType === "trainee" ? "Trainee" : "Intern";
  const internLike = me.personType !== "employee";

  return (
    <PageBody>
      <PageHeader overline="Account" title="My profile" />
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-5">
          <PhotoUpload userId={user.id} name={me.name} photo={me.photo} canEdit />
          <div className="flex min-w-0 flex-1 basis-64 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="font-display text-[22px] leading-tight font-semibold text-ink">{me.name}</h2>
              <OptionChip options={settings.employmentStatuses} value={me.status} />
              <Tag tone={statusTone("personType", me.personType)}>{typeLabel}</Tag>
            </div>
            <div className="text-sm text-ink-2">{[designation?.name, department?.name, me.employeeId].filter(Boolean).join(" · ")}</div>
            <div className="text-[13px] text-muted">{me.email}</div>
          </div>
          {internLike && (
            <Link href={`/interns/${me._id}`} className="text-[13px] font-semibold text-brand-600 hover:underline">
              My internship →
            </Link>
          )}
        </div>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <ProfileForm
            defaults={{
              phone: me.phone,
              personalEmail: me.personalEmail,
              addrLine1: me.address?.line1,
              addrLine2: me.address?.line2,
              city: me.address?.city,
              state: me.address?.state,
              postalCode: me.address?.postalCode,
              country: me.address?.country,
              emergencyName: me.emergencyContact?.name,
              emergencyRelation: me.emergencyContact?.relation,
              emergencyPhone: me.emergencyContact?.phone,
            }}
          />
          <div id="documents" className="scroll-mt-20">
            <DocumentsPanel
              personId={user.id}
              categories={categoriesFor(settings.documentCategories, me.personType)}
              data={docs}
              perms={{ upload: true, manage: false, self: true, seeConfidential: true }}
            />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title="Employment" subtitle="Maintained by HR" />
            <CardBody>
              <DetailList
                columns={1}
                items={[
                  { label: "Employee ID", value: me.employeeId },
                  { label: "Role", value: user.roleName },
                  { label: "Department", value: department?.name ?? "—" },
                  { label: "Designation", value: designation?.name ?? "—" },
                  { label: "Employment type", value: employmentTypeLabel(me.employmentType) },
                  { label: "Joining date", value: me.joiningDate ? `${fmtDate(me.joiningDate)}${tenure ? ` · ${tenure}` : ""}` : "—" },
                  { label: "Team", value: me.team || "—" },
                  { label: "Reports to", value: manager ? <PersonCell name={manager.name} sub={manager.employeeId} photo={manager.photo} /> : "—" },
                  ...(internLike
                    ? [
                        { label: "Mentor", value: mentor ? <PersonCell name={mentor.name} sub={mentor.employeeId} photo={mentor.photo} /> : "—" },
                        { label: "Internship", value: me.internship ? `${fmtDate(me.internship.startDate)} – ${fmtDate(me.internship.endDate)}` : "—" },
                      ]
                    : []),
                  { label: "Login", value: <StatusChip domain="account" value={me.accountActive ? "active" : "inactive"} size="sm" /> },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="My assets" />
            <CardBody>
              {assets.length === 0 ? (
                <p className="text-[13px] text-muted">No assets assigned to you.</p>
              ) : (
                <ul className="flex flex-col">
                  {assets.map((a) => {
                    const issued = [...(a.history ?? [])].reverse().find((h) => h.user?.toString() === user.id);
                    return (
                      <li key={a._id.toString()} className="flex items-start gap-3 border-t border-line-soft py-2.5 first:border-t-0 first:pt-0">
                        <Laptop className="mt-0.5 size-[18px] shrink-0 text-muted" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink">{a.name}</span>
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
          {sessionsCard}
        </div>
      </div>
    </PageBody>
  );
}
