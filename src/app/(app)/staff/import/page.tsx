import type { Metadata } from "next";
import { Download } from "lucide-react";
import { can, requirePagePermission } from "@/lib/auth/session";
import { PageBody, PageHeader } from "@/components/ui/page";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { IMPORT_COLUMNS, MAX_IMPORT_ROWS } from "../_lib/import";
import { ImportClient } from "./import-client";

export const metadata: Metadata = { title: "Import people" };

const COLUMN_NOTES: Record<(typeof IMPORT_COLUMNS)[number], string> = {
  name: "Required",
  email: "Required · work Google email, must be unique",
  personType: "employee, trainee or intern (default employee)",
  role: "Role name or key (default matches the person type)",
  department: "Existing department name or code",
  designation: "Existing designation name",
  employmentType: "full_time, part_time, contract, consultant, trainee, internship",
  joiningDate: "yyyy-mm-dd (default today)",
  phone: "Optional",
  reportingManagerEmail: "Email of an existing active person",
};

export default async function ImportPage() {
  const user = await requirePagePermission("staff.create");
  return (
    <PageBody>
      <PageHeader
        back={{ href: "/staff", label: "Staff" }}
        title="Import people"
        description="Upload a CSV to add many people at once. Every row is checked for duplicates and unknown references before anything is saved."
        actions={
          <ButtonLink href="/staff/import/template" variant="secondary" icon={<Download className="size-4" />}>
            Download template
          </ButtonLink>
        }
      />
      <ImportClient canEnableLogin={can(user, "users.manage")} maxRows={MAX_IMPORT_ROWS} />
      <Card>
        <CardHeader title="Columns" subtitle="Column order doesn't matter; unknown columns are ignored. Remove the example row from the template." />
        <dl className="grid gap-x-6 gap-y-2 px-5 pb-5 text-[13px] sm:grid-cols-2">
          {IMPORT_COLUMNS.map((c) => (
            <div key={c} className="flex flex-col">
              <dt className="font-mono text-xs font-semibold text-ink">{c}</dt>
              <dd className="text-muted">{COLUMN_NOTES[c]}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </PageBody>
  );
}
