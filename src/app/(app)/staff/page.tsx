import type { Metadata } from "next";
import { Download, Plus, Upload, UserSearch } from "lucide-react";
import { can, requirePagePermission } from "@/lib/auth/session";
import { and, asc, count, desc, eq, gt, isNotNull, isNull, lte, ne, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { Department, Designation, StoredFile, User } from "@/lib/models";
import { namesFor } from "@/lib/people";
import { assignableRoles } from "@/lib/rbac/roles";
import { getSettings } from "@/lib/settings";
import { PAGE_SIZE, pageParam, param, sortParam, withParams, type SearchParams, type SortChoices } from "@/lib/query";
import { addDays, fmtDate, todayKey } from "@/lib/time";
import { Alert, EmptyState, PageBody, PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { ChipFilters, ClearFilters, FilterBar, Pagination, SearchInput, SelectFilter, SortSelect } from "@/components/ui/filters";
import { Menu } from "@/components/ui/menu";
import { PersonCell } from "@/components/ui/avatar";
import { OptionChip, StatusChip, Tag } from "@/components/ui/chip";
import { EmptyRow, Td, Th, THead, TableWrap, Tr } from "@/components/ui/table";
import { statusTone } from "@/lib/status";
import { inList, nocase, notInList } from "@/lib/sql";
import { EXITED_STATUSES } from "@/lib/people";
import Link from "next/link";
import { categoriesFor, expiryInfo, missingRequired } from "./_lib/documents";
import { contractFilter, staffFilter, STAFF_TYPES } from "./_lib/directory";
import { contractStatus } from "./_lib/constants";

export const metadata: Metadata = { title: "Staff" };

const TYPE_LABELS: Record<string, string> = { employee: "Employees", trainee: "Trainees", intern: "Interns" };

const SORTS = {
  name: { label: "Name A–Z", order: [asc(nocase(User.name))] },
  nameDesc: { label: "Name Z–A", order: [desc(nocase(User.name))] },
  joinedDesc: { label: "Joined (newest)", order: [desc(User.joiningDate), asc(nocase(User.name))] },
  joined: { label: "Joined (oldest)", order: [asc(sql`coalesce(${User.joiningDate}, '9999-12-31')`), asc(nocase(User.name))] },
  employeeId: { label: "Employee ID", order: [asc(User.employeeId)] },
  updated: { label: "Recently updated", order: [desc(User.updatedAt)] },
} satisfies SortChoices<SQL[]>;

export default async function StaffPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePagePermission("staff.view");
  const sp = await searchParams;
  const settings = await getSettings();
  const today = todayKey();
  const page = pageParam(sp);
  const sort = sortParam(sp, SORTS);
  const filter = staffFilter(sp, settings);
  const canCreate = can(user, "staff.create");
  const canEdit = can(user, "staff.edit");
  const canExport = can(user, "reports.export") || canEdit;

  const [rows, total, typeCounts, departments, designations, roles, contractsEnding] = await Promise.all([
    db()
      .select({
        _id: User._id,
        employeeId: User.employeeId,
        name: User.name,
        photo: User.photo,
        personType: User.personType,
        department: User.department,
        designation: User.designation,
        reportingManager: User.reportingManager,
        joiningDate: User.joiningDate,
        contractStart: User.contractStart,
        contractEnd: User.contractEnd,
        status: User.status,
        accountActive: User.accountActive,
      })
      .from(User)
      .where(filter)
      .orderBy(...sort.order)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db().$count(User, filter),
    db()
      .select({ personType: User.personType, n: count() })
      .from(User)
      .where(staffFilter(sp, settings, { ignoreType: true }))
      .groupBy(User.personType),
    db().select({ _id: Department._id, name: Department.name }).from(Department).orderBy(asc(Department.name)),
    db().select({ _id: Designation._id, name: Designation.name }).from(Designation),
    assignableRoles(),
    canEdit ? db().$count(User, and(inList(User.personType, [...STAFF_TYPES]), notInList(User.status, EXITED_STATUSES), contractFilter("ending", today))) : Promise.resolve(0),
  ]);

  const managers = await namesFor(rows.map((r) => r.reportingManager));
  const deptName = new Map(departments.map((d) => [d._id, d.name]));
  const desigName = new Map(designations.map((d) => [d._id, d.name]));
  const counts = new Map(typeCounts.map((c) => [c.personType, c.n]));
  const allCount = STAFF_TYPES.reduce((sum, t) => sum + (counts.get(t) ?? 0), 0);

  // Document completeness for the rows on this page (HR only) and the org-wide expiry banner.
  const docState = new Map<string, { present: Set<string>; expired: boolean; expiring: boolean }>();
  let expiringCount = 0;
  if (canEdit) {
    const ids = rows.map((r) => r._id);
    const [files, expiring] = await Promise.all([
      db()
        .select({ entityId: StoredFile.entityId, category: StoredFile.category, expiryDate: StoredFile.expiryDate })
        .from(StoredFile)
        .where(
          and(
            eq(StoredFile.entityType, "user"),
            inList(StoredFile.entityId, ids),
            isNull(StoredFile.deletedAt),
            isNull(StoredFile.replacedBy),
            isNotNull(StoredFile.category),
            ne(StoredFile.category, ""),
          ),
        ),
      db().$count(
        StoredFile,
        and(
          eq(StoredFile.entityType, "user"),
          isNull(StoredFile.deletedAt),
          isNull(StoredFile.replacedBy),
          gt(StoredFile.expiryDate, ""),
          lte(StoredFile.expiryDate, addDays(today, 30)),
        ),
      ),
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
  const hasFilters = Object.entries(sp).some(([k, v]) => k !== "page" && k !== "sort" && v);
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

      {canEdit && contractsEnding > 0 && param(sp, "contract") !== "ending" && (
        <Alert
          tone="warning"
          title={`${contractsEnding} ${contractsEnding === 1 ? "contract ends" : "contracts end"} within 30 days.`}
          action={
            <Link href="/staff?contract=ending" className="shrink-0 text-xs font-semibold underline underline-offset-2">
              Show them
            </Link>
          }
        >
          Renew the contract period from the profile, or start the exit.
        </Alert>
      )}

      <Card>
        <div className="flex flex-col gap-3 border-b border-line-soft px-4 py-3.5">
          <ChipFilters param="type" options={typeOptions} />
          <FilterBar>
            <SearchInput placeholder="Name, email or employee ID" />
            <SelectFilter param="department" label="Department" allLabel="All departments" options={departments.map((d) => ({ value: d._id, label: d.name }))} />
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
            <SelectFilter
              param="contract"
              label="Contract"
              allLabel="Any contract"
              options={[
                { value: "ending", label: "Ending within 30 days" },
                { value: "ended", label: "Contract ended" },
                { value: "any", label: "Has a contract period" },
              ]}
            />
            <SortSelect options={sort.options} />
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
              const id = r._id;
              const dept = r.department ? deptName.get(r.department) : undefined;
              const desig = r.designation ? desigName.get(r.designation) : undefined;
              const docs = docState.get(id);
              const missing = canEdit ? missingRequired(settings.documentCategories, r.personType, docs?.present ?? new Set()).length : 0;
              const categories = categoriesFor(settings.documentCategories, r.personType).length;
              const contract = contractStatus(r.contractStart, r.contractEnd, today);
              return (
                <Tr key={id} href={`/staff/${id}`}>
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
                  <Td className="text-ink-2">{r.reportingManager ? (managers.get(r.reportingManager) ?? "—") : "—"}</Td>
                  <Td className="whitespace-nowrap text-ink-2">
                    {fmtDate(r.joiningDate)}
                    {contract && (
                      <div className={contract.state === "ended" ? "text-xs text-danger" : contract.state === "ending" ? "text-xs text-warning" : "text-xs text-muted"}>
                        {r.contractEnd ? `Contract to ${fmtDate(r.contractEnd)}` : "Open-ended contract"}
                      </div>
                    )}
                  </Td>
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
