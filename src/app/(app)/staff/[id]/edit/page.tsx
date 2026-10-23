import type { Metadata } from "next";
import { forbidden, notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { can, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { User } from "@/lib/models";
import { peopleOptions } from "@/lib/people";
import { todayKey } from "@/lib/time";
import { isObjectId } from "@/lib/validation";
import { PageBody, PageHeader } from "@/components/ui/page";
import { personAccess } from "../../_lib/people-access";
import { EditPersonForm } from "./edit-form";

export const metadata: Metadata = { title: "Edit person" };

export default async function EditPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  const [target] = await db()
    .select({
      _id: User._id,
      name: User.name,
      email: User.email,
      phone: User.phone,
      personalEmail: User.personalEmail,
      dob: User.dob,
      gender: User.gender,
      bloodGroup: User.bloodGroup,
      address: User.address,
      emergencyContact: User.emergencyContact,
      employmentType: User.employmentType,
      team: User.team,
      joiningDate: User.joiningDate,
      personType: User.personType,
      reportingManager: User.reportingManager,
      internship: User.internship,
    })
    .from(User)
    .where(eq(User._id, id))
    .limit(1);
  if (!target || target.personType === "admin") notFound();
  const access = personAccess(user, target);
  if (!access.canEdit) forbidden();

  const people = access.internLike ? await peopleOptions() : [];
  const i = target.internship;
  return (
    <PageBody>
      <PageHeader back={{ href: `/staff/${id}`, label: target.name }} title={`Edit ${target.name}`} />
      <EditPersonForm
        today={todayKey()}
        internLike={access.internLike}
        canEmail={can(user, "users.manage")}
        people={people}
        person={{
          id,
          name: target.name,
          email: target.email,
          phone: target.phone ?? undefined,
          personalEmail: target.personalEmail ?? undefined,
          dob: target.dob ?? undefined,
          gender: target.gender ?? undefined,
          bloodGroup: target.bloodGroup ?? undefined,
          addrLine1: target.address?.line1,
          addrLine2: target.address?.line2,
          city: target.address?.city,
          state: target.address?.state,
          postalCode: target.address?.postalCode,
          country: target.address?.country,
          emergencyName: target.emergencyContact?.name,
          emergencyRelation: target.emergencyContact?.relation,
          emergencyPhone: target.emergencyContact?.phone,
          employmentType: target.employmentType,
          team: target.team ?? undefined,
          joiningDate: target.joiningDate ?? undefined,
          internship: i
            ? { startDate: i.startDate, endDate: i.endDate, college: i.college, course: i.course, assignedRole: i.assignedRole, mentor: i.mentor }
            : undefined,
        }}
      />
    </PageBody>
  );
}
