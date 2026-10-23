import Link from "next/link";
import { forbidden } from "next/navigation";
import { KeyRound } from "lucide-react";
import { PersonCell } from "@/components/ui/avatar";
import { Card, CardFooter } from "@/components/ui/card";
import { OptionChip, StatusChip, Tag } from "@/components/ui/chip";
import { ClearFilters, FilterBar, Pagination, SearchInput, SelectFilter } from "@/components/ui/filters";
import { Alert, PageBody, PageHeader } from "@/components/ui/page";
import { EmptyRow, TableWrap, THead, Td, Th, Tr } from "@/components/ui/table";
import { LinkTabs } from "@/components/ui/tabs";
import { can, requirePagePermission } from "@/lib/auth/session";
import { cn } from "@/lib/cn";
import { connectDB } from "@/lib/db";
import { PERSON_TYPES, Role, User } from "@/lib/models";
import { pageParam, PAGE_SIZE, param, searchRegex, type SearchParams } from "@/lib/query";
import { ROLE_KEYS } from "@/lib/rbac/permissions";
import { assignableRoles, ensureRoles } from "@/lib/rbac/roles";
import { getSettings } from "@/lib/settings";
import { timeAgo } from "@/lib/time";
import { CreateRoleButton, RoleEditor, type RoleView } from "./role-editor";
import { LinkSelect } from "../settings/ui";
import { UserActions } from "./user-actions";

export const metadata = { title: "Roles & access" };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePagePermission("roles.manage", "users.manage");
  const sp = await searchParams;
  const canRoles = can(user, "roles.manage");
  const canUsers = can(user, "users.manage");

  const asked = param(sp, "tab");
  if (asked === "users" && !canUsers) forbidden();
  if (asked === "roles" && !canRoles) forbidden();
  const tab = asked === "users" || !canRoles ? "users" : "roles";
  const roles = tab === "roles" ? await loadRoles() : [];

  return (
    <PageBody>
      <PageHeader
        overline="Admin"
        title="Roles & access"
        description="What each role can do, and who has which role and sign-in access. Every change is audited."
        actions={tab === "roles" ? <CreateRoleButton roles={roles.map((r) => ({ key: r.key, name: r.name }))} /> : undefined}
      />
      {canRoles && canUsers && (
        <LinkTabs
          items={[
            { href: "/roles", label: "Roles & permissions", active: tab === "roles" },
            { href: "/roles?tab=users", label: "Users", active: tab === "users" },
          ]}
        />
      )}
      {tab === "roles" ? <RolesTab sp={sp} roles={roles} /> : <UsersTab sp={sp} currentUserId={user.id} />}
    </PageBody>
  );
}

async function loadRoles(): Promise<RoleView[]> {
  await ensureRoles();
  const [roles, counts, superAdmins] = await Promise.all([
    Role.find().lean(),
    User.aggregate<{ _id: string; n: number }>([{ $match: { isSuperAdmin: { $ne: true } } }, { $group: { _id: "$role", n: { $sum: 1 } } }]),
    User.countDocuments({ isSuperAdmin: true }),
  ]);
  const byRole = new Map(counts.map((c) => [c._id, c.n]));
  const order = new Map<string, number>(ROLE_KEYS.map((k, i) => [k, i]));
  return roles
    .map((r) => ({
      key: r.key,
      name: r.name,
      description: r.description,
      system: r.system,
      permissions: r.permissions,
      userCount: r.key === "super_admin" ? superAdmins : (byRole.get(r.key) ?? 0),
    }))
    .sort((a, b) => (order.get(a.key) ?? 100) - (order.get(b.key) ?? 100) || a.name.localeCompare(b.name));
}

function RolesTab({ sp, roles }: { sp: SearchParams; roles: RoleView[] }) {
  const selected = roles.find((r) => r.key === param(sp, "role")) ?? roles.find((r) => r.key !== "super_admin") ?? roles[0];
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <LinkSelect
        className="lg:hidden"
        label="Role"
        value={selected.key}
        items={roles.map((r) => ({ value: r.key, label: `${r.name} (${r.userCount})`, href: `/roles?role=${r.key}` }))}
      />
      <nav aria-label="Roles" className="hidden w-64 shrink-0 flex-col gap-0.5 rounded-[14px] border border-line bg-white p-2 lg:flex">
        {roles.map((r) => (
          <Link
            key={r.key}
            href={`/roles?role=${r.key}`}
            aria-current={r.key === selected.key ? "page" : undefined}
            className={cn(
              "flex items-center justify-between gap-3 rounded-[10px] px-3 py-2.5 text-sm transition-colors",
              r.key === selected.key ? "bg-brand-50 font-semibold text-brand-600" : "font-medium text-ink hover:bg-field",
            )}
          >
            <span>{r.name}</span>
            <span className={cn("rounded-full px-1.5 text-[11px] font-semibold tabular", r.key === selected.key ? "bg-brand-100 text-brand-600" : "bg-track text-tone-gray")}>{r.userCount}</span>
          </Link>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        <RoleEditor key={`${selected.key}:${selected.permissions.join(",")}:${selected.name}`} role={selected} />
      </div>
    </div>
  );
}

async function UsersTab({ sp, currentUserId }: { sp: SearchParams; currentUserId: string }) {
  await connectDB();
  const q = param(sp, "q");
  const roleFilter = param(sp, "role");
  const access = param(sp, "access");
  const page = pageParam(sp);

  const filter: Record<string, unknown> = { personType: { $in: PERSON_TYPES } };
  const rx = searchRegex(q);
  if (rx) filter.$or = [{ name: rx }, { email: rx }, { employeeId: rx }];
  if (roleFilter) filter.role = roleFilter;
  if (access === "active") filter.accountActive = true;
  if (access === "inactive") filter.accountActive = { $ne: true };

  const [people, total, roles, superAdmin, roleDocs, settings] = await Promise.all([
    User.find(filter, { name: 1, email: 1, employeeId: 1, photo: 1, role: 1, accountActive: 1, lastLoginAt: 1, status: 1 })
      .sort({ name: 1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
    User.countDocuments(filter),
    assignableRoles(),
    User.findOne({ isSuperAdmin: true }, { name: 1, email: 1, photo: 1, lastLoginAt: 1 }).lean(),
    Role.find({}, { key: 1, name: 1 }).lean(),
    getSettings(),
  ]);
  const roleNames = new Map(roleDocs.map((r) => [r.key, r.name]));

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-center gap-4 px-5 py-4">
        <span className="flex size-10 items-center justify-center rounded-xl bg-navy text-white">
          <KeyRound className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">{superAdmin?.name ?? "Super admin"}</span>
            <Tag tone="purple">Super Admin</Tag>
            <Tag>Read-only</Tag>
          </div>
          <div className="text-[13px] text-muted">
            {superAdmin ? `${superAdmin.email}${superAdmin.lastLoginAt ? ` · last sign-in ${timeAgo(superAdmin.lastLoginAt)}` : ""}` : "Created the first time the super admin signs in."}
          </div>
        </div>
        <p className="max-w-md text-[13px] text-muted">
          There is exactly one super admin. It is configured through server environment variables (email, password and optional two-step code), has every permission and can&apos;t be edited, disabled or reassigned here.
        </p>
      </Card>

      <FilterBar>
        <SearchInput placeholder="Search name, email or ID" />
        <SelectFilter param="role" allLabel="All roles" options={roles.map((r) => ({ value: r.key, label: r.name }))} />
        <SelectFilter
          param="access"
          allLabel="Any access"
          options={[
            { value: "active", label: "Login enabled" },
            { value: "inactive", label: "No access" },
          ]}
        />
        <ClearFilters />
      </FilterBar>

      <Alert tone="info">Changing a role or login access signs the person out of every device, records the change in their history and the audit trail, and sends them a notification.</Alert>

      <Card>
        <TableWrap phone={[1, 2, 5]} tablet={[1, 2, 3, 5]}>
          <THead>
            <Th>Person</Th>
            <Th>Role</Th>
            <Th>Login access</Th>
            <Th>Last sign-in</Th>
            <Th align="right">
              <span className="sr-only">Actions</span>
            </Th>
          </THead>
          <tbody>
            {people.length === 0 && <EmptyRow colSpan={5}>No people match these filters.</EmptyRow>}
            {people.map((p) => {
              const id = p._id.toString();
              return (
                <Tr key={id}>
                  <Td>
                    <PersonCell name={p.name} photo={p.photo} sub={`${p.employeeId} · ${p.email}`} />
                  </Td>
                  <Td>
                    <Tag tone="blue">{roleNames.get(p.role) ?? p.role}</Tag>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusChip domain="account" value={p.accountActive ? "active" : "inactive"} />
                      {p.status !== "active" && <OptionChip options={settings.employmentStatuses} value={p.status} />}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap text-ink-2">{p.lastLoginAt ? timeAgo(p.lastLoginAt) : "Never"}</Td>
                  <Td align="right">
                    <UserActions id={id} name={p.name} role={p.role} roleName={roleNames.get(p.role) ?? p.role} accountActive={Boolean(p.accountActive)} roles={roles} isSelf={id === currentUserId} />
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </TableWrap>
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
        <CardFooter className="text-xs text-muted">The super admin is not listed here. Employees, trainees and interns only.</CardFooter>
      </Card>
    </div>
  );
}
