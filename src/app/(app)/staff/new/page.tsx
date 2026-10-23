import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { can, requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Department, Designation } from "@/lib/models";
import { peopleOptions } from "@/lib/people";
import { param, type SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { todayKey } from "@/lib/time";
import { PageBody, PageHeader } from "@/components/ui/page";
import { roleOptionsFor } from "../_lib/person";
import type { NewPersonType } from "../_lib/constants";
import { NewPersonForm } from "./new-person-form";

export const metadata: Metadata = { title: "Add person" };

export default async function NewPersonPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePagePermission("staff.create");
  const sp = await searchParams;
  const [settings, departments, designations, roles, people] = await Promise.all([
    getSettings(),
    db().select({ _id: Department._id, name: Department.name }).from(Department).where(eq(Department.active, true)).orderBy(asc(Department.name)),
    db().select({ _id: Designation._id, name: Designation.name, department: Designation.department }).from(Designation).where(eq(Designation.active, true)).orderBy(asc(Designation.name)),
    roleOptionsFor(user),
    peopleOptions(),
  ]);
  const requested = param(sp, "type");
  const defaultType: NewPersonType = requested === "intern" || requested === "trainee" ? requested : "employee";

  return (
    <PageBody>
      <PageHeader back={{ href: "/staff", label: "Staff" }} title="Add person" description="Create the record, then collect documents and activate access from the profile." />
      <NewPersonForm
        today={todayKey()}
        defaultType={defaultType}
        roles={roles}
        departments={departments.map((d) => ({ id: d._id, name: d.name }))}
        designations={designations.map((d) => ({ id: d._id, name: d.name, department: d.department ?? undefined }))}
        people={people}
        documentCategories={settings.documentCategories.map((c) => ({ key: c.key, label: c.label, required: c.required, appliesTo: c.appliesTo, confidential: c.confidential }))}
        canSalary={can(user, "staff.confidential")}
        canAccess={can(user, "users.manage")}
      />
    </PageBody>
  );
}
