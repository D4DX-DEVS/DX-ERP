import type { Metadata } from "next";
import { Download, Plus, Upload, UserSearch } from "lucide-react";
import { can, requirePagePermission } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Department, Designation, StoredFile, User } from "@/lib/models";
import { namesFor } from "@/lib/people";
import { assignableRoles } from "@/lib/rbac/roles";
import { getSettings } from "@/lib/settings";
import { PAGE_SIZE, pageParam, withParams, type SearchParams } from "@/lib/query";
import { addDays, fmtDate, todayKey } from "@/lib/time";
import { Alert, EmptyState, PageBody, PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { ChipFilters, ClearFilters, FilterBar, Pagination, SearchInput, SelectFilter } from "@/components/ui/filters";
import { Menu } from "@/components/ui/menu";
import { PersonCell } from "@/components/ui/avatar";
import { OptionChip, StatusChip, Tag } from "@/components/ui/chip";
import { EmptyRow, Td, Th, THead, TableWrap, Tr } from "@/components/ui/table";
import { statusTone } from "@/lib/status";
import { categoriesFor, expiryInfo, missingRequired } from "./_lib/documents";
import { staffFilter, STAFF_TYPES } from "./_lib/directory";

export const metadata: Metadata = { title: "Staff" };

const TYPE_LABELS: Record<string, string> = { employee: "Employees", trainee: "Trainees", intern: "Interns" };

export default async function StaffPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePagePermission("staff.view");
  const sp = await searchParams;
  await connectDB();
  const settings = await getSettings();
  const today = todayKey();
  const page = pageParam(sp);
  const filter = staffFilter(sp, settings);
  const canCreate = can(user, "staff.create");
  const canEdit = can(user, "staff.edit");
  const canExport = can(user, "reports.export") || canEdit;

  const [rows, total, typeCounts, departments, designations, roles] = await Promise.all([
    User.find(filter, {
      employeeId: 1,
      name: 1,
      photo: 1,
      personType: 1,
      department: 1,
      designation: 1,
      reportingManager: 1,
      joiningDate: 1,
      status: 1,
      accountActive: 1,
    })
      .sort({ name: 1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
    User.countDocuments(filter),
    User.aggregate<{ _id: string; n: number }>([{ $match: staffFilter(sp, settings, { ignoreType: true }) }, { $group: { _id: "$personType", n: { $sum: 1 } } }]),
    Department.find({}, { name: 1 }).sort({ name: 1 }).lean(),
    Designation.find({}, { name: 1 }).lean(),
    assignableRoles(),
  ]);

  const managers = await namesFor(rows.map((r) => r.reportingManager));
  const deptName = new Map(departments.map((d) => [d._id.toString(), d.name]));
  const desigName = new Map(designations.map((d) => [d._id.toString(), d.name]));
  const counts = new Map(typeCounts.map((c) => [c._id, c.n]));
  const allCount = STAFF_TYPES.reduce((sum, t) => sum + (counts.get(t) ?? 0), 0);

  // Document completeness for the rows on this page (HR only) and the org-wide expiry banner.
  const docState = new Map<string, { present: Set<string>; expired: boolean; expiring: boolean }>();
  let expiringCount = 0;
  if (canEdit) {
    const ids = rows.map((r) => r._id.toString());
    const [files, expiring] = await Promise.all([
      StoredFile.find(
        { entityType: "user", entityId: { $in: ids }, deletedAt: null, replacedBy: null, category: { $nin: [null, ""] } },
        { entityId: 1, category: 1, expiryDate: 1 },
      ).lean(),
      StoredFile.countDocuments({ entityType: "user", deletedAt: null, replacedBy: null, expiryDate: { $gt: "", $lte: addDays(today, 30) } }),
    ]);
    expiringCount = expiring;
    for (const f of files) {
      const key = f.entityId ?? "";
      const entry = docState.get(key) ?? { present: new Set<string>(), expired: false, expiring: false };
      entry.present.add(f.category!);
      const info = expiryInfo(f.expiryDate, today);
      if (info.state === "expired") entry.expired = true;
      if (info.state === "expiring") entry.expiring = true;
      docState.set(key, entry);
    }
  }

  const typeOptions = [
    { value: "", label: "All", count: allCount },
    ...STAFF_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t], count: counts.get(t) ?? 0 })),
  ];
  const hasFilters = Object.entries(sp).some(([k, v]) => k !== "page" && v);
  const colCount = canEdit ? 8 : 7;

  return (
    <PageBody>
      <PageHeader
        overline="People"
        title={
          <>
            Staff <span className="ml-1 text-base font-medium text-muted">{allCount} {allCount === 1 ? "person" : "people"}</span>
          </>
        }
        actions={
          <>
            {canCreate && (
              <ButtonLink href="/staff/import" variant="secondary" icon={<Upload className="size-4" />}>
                Import CSV
              </ButtonLink>
            )}
            {canExport && (
              <Menu
                trigger={
                  <button type="button" className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line-strong bg-white px-3.5 text-sm font-semibold text-ink hover:bg-field">
                    <Download className="size-4" /> Export
                  </button>
                }
                items={(["xlsx", "csv", "pdf"] as const).map((f) => ({
                  label: f === "xlsx" ? "Excel (.xlsx)" : f.toUpperCase(),
                  href: withParams("/staff/export", sp, { format: f }),
                  external: true,
                }))}
              />
            )}
            {canCreate && (
              <ButtonLink href="/staff/new" icon={<Plus className="size-4" />}>
                Add person
              </ButtonLink>
            )}
          </>
        }
      />

      {canEdit && expiringCount > 0 && (
        <Alert tone="warning" title={`${expiringCount} ${expiringCount === 1 ? "document has" : "documents have"} expired or expire within 30 days.`}>
          Open a profile&apos;s Documents tab to upload a replacement. Reminders are sent to the owner and HR automatically.
        </Alert>
      )}

      <Card>
        <div className="flex flex-col gap-3 border-b border-line-soft px-4 py-3.5">
          <ChipFilters param="type" options={typeOptions} />
          <FilterBar>
            <SearchInput placeholder="Name, email or employee ID" />
            <SelectFilter param="department" label="Department" allLabel="All departments" options={departments.map((d) => ({ value: d._id.toString(), label: d.name }))} />
            <SelectFilter param="status" label="Employment status" allLabel="Any status" options={settings.employmentStatuses.map((s) => ({ value: s.key, label: s.label }))} />
            <SelectFilter param="role" label="Role" allLabel="All roles" options={roles.map((r) => ({ value: r.key, label: r.name }))} />
            <SelectFilter
              param="access"
              label="Login access"
              allLabel="Any login access"
              options={[
                { value: "on", label: "Login enabled" },
                { value: "off", label: "No login access" },
              ]}
            />
            <ClearFilters />
          </FilterBar>
        </div>

        <TableWrap phone={[1, 6]} tablet={[1, 2, 6, 7]}>
          <THead>
            <Th>Person</Th>
            <Th>Designation</Th>
            <Th>Type</Th>
            <Th>Reports to</Th>
            <Th>Joined</Th>
            <Th>Status</Th>
            <Th>Login</Th>
            {canEdit && <Th>Documents</Th>}
          </THead>
          <tbody>
            {rows.length === 0 && (
              <EmptyRow colSpan={colCount}>
                <EmptyState
                  icon={<UserSearch className="size-5" />}
                  title={hasFilters ? "No one matches these filters" : "No staff records yet"}
                  description={hasFilters ? "Try a different search or clear the filters." : canCreate ? "Add the first person to start building the directory." : undefined}
                  action={!hasFilters && canCreate ? <ButtonLink href="/staff/new">Add person</ButtonLink> : undefined}
                />
              </EmptyRow>
            )}
            {rows.map((r) => {
              const id = r._id.toString();
              const dept = r.department ? deptName.get(r.department.toString()) : undefined;
              const desig = r.designation ? desigName.get(r.designation.toString()) : undefined;
              const docs = docState.get(id);
              const missing = canEdit ? missingRequired(settings.documentCategories, r.personType, docs?.present ?? new Set()).length : 0;
              const categories = categoriesFor(settings.documentCategories, r.personType).length;
              return (
                <Tr key={id}>
                  <Td>
                    <PersonCell name={r.name} sub={r.employeeId} photo={r.photo} href={`/staff/${id}`} />
                  </Td>
                  <Td>
                    <div className="text-ink">{desig ?? "—"}</div>
                    {dept && <div className="text-xs text-muted">{dept}</div>}
                  </Td>
                  <Td>
                    <Tag tone={statusTone("personType", r.personType)}>{r.personType === "employee" ? "Employee" : r.personType === "trainee" ? "Trainee" : "Intern"}</Tag>
                  </Td>
                  <Td className="text-ink-2">{r.reportingManager ? (managers.get(r.reportingManager.toString()) ?? "—") : "—"}</Td>
                  <Td className="whitespace-nowrap text-ink-2">{fmtDate(r.joiningDate)}</Td>
                  <Td>
                    <OptionChip options={settings.employmentStatuses} value={r.status} />
                  </Td>
                  <Td>
                    <StatusChip domain="account" value={r.accountActive ? "active" : "inactive"} size="sm" />
                  </Td>
                  {canEdit && (
                    <Td className="text-xs font-semibold whitespace-nowrap">
                      {missing > 0 ? (
                        <span className="text-warning">{missing} missing</span>
                      ) : docs?.expired ? (
                        <span className="text-danger">Expired</span>
                      ) : docs?.expiring ? (
                        <span className="text-warning">Expiring</span>
                      ) : categories === 0 ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <span className="text-success">Complete</span>
                      )}
                    </Td>
                  )}
                </Tr>
              );
            })}
          </tbody>
        </TableWrap>
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
      </Card>
    </PageBody>
  );
}
