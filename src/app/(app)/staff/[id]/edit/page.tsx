import type { Metadata } from "next";
import { forbidden, notFound } from "next/navigation";
import { can, requireUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
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
  await connectDB();
  const target = await User.findById(id, {
    name: 1,
    email: 1,
    phone: 1,
    personalEmail: 1,
    dob: 1,
    gender: 1,
    bloodGroup: 1,
    address: 1,
    emergencyContact: 1,
    employmentType: 1,
    team: 1,
    joiningDate: 1,
    personType: 1,
    reportingManager: 1,
    internship: 1,
  }).lean();
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
          phone: target.phone,
          personalEmail: target.personalEmail,
          dob: target.dob,
          gender: target.gender,
          bloodGroup: target.bloodGroup,
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
          team: target.team,
          joiningDate: target.joiningDate,
          internship: i
            ? { startDate: i.startDate, endDate: i.endDate, college: i.college, course: i.course, assignedRole: i.assignedRole, mentor: i.mentor?.toString() }
            : undefined,
        }}
      />
    </PageBody>
  );
}
