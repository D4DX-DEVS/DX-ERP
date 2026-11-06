import Link from "next/link";
import { forbidden } from "next/navigation";
import { and, asc, count, desc, eq, gt, gte, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { Segmented } from "@/components/ui/tabs";
import { PageBody, PageHeader } from "@/components/ui/page";
import { can, requirePagePermission, type CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { fiscalYear } from "@/lib/counters";
import { env } from "@/lib/env";
import { cn } from "@/lib/cn";
import { kioskStatus } from "@/lib/domain/kiosk";
import { Asset, AttendanceKiosk, Backup, Department, Designation, Expense, Holiday, Lead, LeaveBalance, LeaveRequest, LeaveType, StoredFile, User } from "@/lib/models";
import { namesFor, peopleOptions } from "@/lib/people";
import { param, type SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { jsonLength } from "@/lib/sql";
import { timeAgo, todayKey } from "@/lib/time";
import { BackupPanel, type BackupRow } from "./backup-panel";
import { KioskCard } from "./kiosk-card";
import { EMPLOYMENT_CATEGORIES, PIPELINE_CATEGORIES, PROJECT_CATEGORIES, SECTIONS, TASK_CATEGORIES } from "./constants";
import { statusUsage } from "./helpers";
import { saveEmploymentStatuses, savePipelineStages, saveProjectStatuses, saveTaskStatuses } from "./actions";
import { DocumentCategoriesEditor, MovementForm, PayrollForm, StatusEditor, StringListEditor, TaxesForm, type StatusRow } from "./list-forms";
import { LinkSelect } from "./ui";
import { DepartmentsCard, DesignationsCard, HolidaysCard, LeaveTypesCard } from "./org-forms";
import { AttendanceForm, CompanyForm, DataSecurityForm, GstBankForm, LeaveSettingsForm, NotificationsForm, NumberingForm, TemplatesForm } from "./simple-forms";

export const metadata = { title: "Configuration" };
// Backup / restore run inside server actions of this page and can take a while on large databases.
export const maxDuration = 300;

const humanize = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
const asOptions = (values: readonly string[]) => values.map((value) => ({ value, label: humanize(value) }));

async function groupCounts(rows: PromiseLike<{ key: string | null; n: number }[]>): Promise<Record<string, number>> {
  return Object.fromEntries((await rows).filter((r) => r.key).map((r) => [r.key as string, r.n]));
}

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePagePermission("settings.manage", "backup.manage");
  const sp = await searchParams;

  const requested = SECTIONS.find((s) => s.key === param(sp, "section"));
  if (requested && !can(user, requested.permission)) forbidden();
  const visible = SECTIONS.filter((s) => can(user, s.permission));
  const active = requested ?? visible[0];

  const href = (key: string) => `/settings?section=${key}`;

  return (
    <PageBody>
      <PageHeader
        overline="Admin"
        title="Configuration"
        description={`${active.description} Every change is written to the audit trail.`}
      />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <nav aria-label="Settings sections" className="scrollbar-thin hidden w-56 shrink-0 flex-col gap-0.5 rounded-[14px] border border-line bg-white p-2 lg:sticky lg:top-24 lg:flex lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto">
          {visible.map((s) => (
            <Link
              key={s.key}
              href={href(s.key)}
              aria-current={s.key === active.key ? "page" : undefined}
              className={cn(
                "rounded-[10px] px-3 py-2.5 text-sm transition-colors",
                s.key === active.key ? "bg-brand-50 font-semibold text-brand-600" : "font-medium text-ink hover:bg-field",
              )}
            >
              {s.label}
            </Link>
          ))}
        </nav>
        <LinkSelect className="lg:hidden" label="Settings section" value={active.key} items={visible.map((s) => ({ value: s.key, label: s.label, href: href(s.key) }))} />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <SectionBody section={active.key} sp={sp} user={user} />
        </div>
      </div>
    </PageBody>
  );
}

async function SectionBody({ section, sp, user }: { section: string; sp: SearchParams; user: CurrentUser }) {
  const settings = await getSettings();
  const stamp = (v: unknown) => JSON.stringify(v);

  switch (section) {
    case "company":
      return <CompanyForm key={stamp(settings.company)} company={settings.company} storageConfigured={env.storage.configured} />;

    case "gst":
      return <GstBankForm key={stamp([settings.company, settings.bank, settings.documents.bankDetails])} company={settings.company} bank={settings.bank} bankDetails={settings.documents.bankDetails} />;

    case "organization": {
      const [depts, desigs, deptPeople, desigPeople, people] = await Promise.all([
        db().select().from(Department).orderBy(asc(Department.name)),
        db().select().from(Designation).orderBy(asc(Designation.level), asc(Designation.name)),
        groupCounts(db().select({ key: User.department, n: count() }).from(User).groupBy(User.department)),
        groupCounts(db().select({ key: User.designation, n: count() }).from(User).groupBy(User.designation)),
        peopleOptions(),
      ]);
      const heads = await namesFor(depts.map((d) => d.head));
      const deptNames = new Map(depts.map((d) => [d._id, d.name]));
      const designationCount = new Map<string, number>();
      for (const d of desigs) if (d.department) designationCount.set(d.department, (designationCount.get(d.department) ?? 0) + 1);
      return (
        <>
          <DepartmentsCard
            people={people}
            departments={depts.map((d) => ({
              id: d._id,
              name: d.name,
              code: d.code ?? undefined,
              description: d.description ?? undefined,
              active: d.active,
              head: d.head ? { id: d.head, name: heads.get(d.head) ?? "Unknown" } : undefined,
              people: deptPeople[d._id] ?? 0,
              designations: designationCount.get(d._id) ?? 0,
            }))}
          />
          <DesignationsCard
            departments={depts.map((d) => ({ id: d._id, name: d.name }))}
            designations={desigs.map((d) => ({
              id: d._id,
              name: d.name,
              department: d.department ? { id: d.department, name: deptNames.get(d.department) ?? "Unknown" } : undefined,
              level: d.level ?? undefined,
              active: d.active,
              people: desigPeople[d._id] ?? 0,
            }))}
          />
        </>
      );
    }

    case "attendance": {
      const screens = await db()
        .select({ _id: AttendanceKiosk._id, name: AttendanceKiosk.name, deviceId: AttendanceKiosk.deviceId, lastSeenAt: AttendanceKiosk.lastSeenAt })
        .from(AttendanceKiosk)
        .orderBy(asc(AttendanceKiosk.createdAt));
      return (
        <>
          <AttendanceForm key={stamp(settings.attendance)} attendance={settings.attendance} />
          <KioskCard
            screens={screens.map((s) => ({
              id: s._id,
              name: s.name,
              status: kioskStatus(s),
              lastSeen: s.deviceId ? `Last seen ${timeAgo(s.lastSeenAt)}` : "Link not opened yet",
            }))}
          />
        </>
      );
    }

    case "holidays": {
      const current = todayKey().slice(0, 4);
      const asked = param(sp, "year");
      const year = /^\d{4}$/.test(asked) ? asked : current;
      const [holidays, yearRows] = await Promise.all([
        db().select().from(Holiday).where(and(gte(Holiday.date, `${year}-01-01`), lte(Holiday.date, `${year}-12-31`))).orderBy(asc(Holiday.date)),
        db().selectDistinct({ year: sql<string>`substr(${Holiday.date}, 1, 4)` }).from(Holiday),
      ]);
      const years = [...new Set([...yearRows.map((r) => r.year), String(Number(current) - 1), current, String(Number(current) + 1), year])].sort();
      return (
        <>
          <Segmented className="self-start" items={years.map((y) => ({ href: `/settings?section=holidays&year=${y}`, label: y, active: y === year }))} />
          <HolidaysCard key={year + stamp(holidays.map((h) => [h.date, h.name, h.optional]))} year={year} holidays={holidays.map((h) => ({ id: h._id, date: h.date, name: h.name, optional: h.optional }))} />
        </>
      );
    }

    case "leave": {
      const [types, requests, adjusted] = await Promise.all([
        db().select().from(LeaveType).orderBy(asc(LeaveType.order), asc(LeaveType.name)),
        groupCounts(db().select({ key: LeaveRequest.leaveType, n: count() }).from(LeaveRequest).groupBy(LeaveRequest.leaveType)),
        groupCounts(
          db()
            .select({ key: LeaveBalance.leaveType, n: count() })
            .from(LeaveBalance)
            .where(or(ne(LeaveBalance.carriedForward, 0), ne(LeaveBalance.adjustment, 0), isNotNull(LeaveBalance.quotaOverride), gt(jsonLength(LeaveBalance.notes), 0)))
            .groupBy(LeaveBalance.leaveType),
        ),
      ]);
      const views = types.map((t) => ({
        id: t._id,
        name: t.name,
        code: t.code,
        color: t.color ?? undefined,
        annualQuota: t.annualQuota,
        accrual: t.accrual,
        kind: t.kind,
        carryForward: t.carryForward,
        maxCarryForward: t.maxCarryForward,
        paid: t.paid,
        allowHalfDay: t.allowHalfDay,
        requiresHrApproval: t.requiresHrApproval,
        requiresAttachmentAfterDays: t.requiresAttachmentAfterDays ?? undefined,
        applicableTo: t.applicableTo,
        active: t.active,
        order: t.order,
        inUse: (requests[t._id] ?? 0) > 0 || (adjusted[t._id] ?? 0) > 0,
      }));
      return (
        <>
          <LeaveTypesCard key={stamp(views)} types={views} />
          <LeaveSettingsForm key={stamp(settings.leave)} leave={settings.leave} />
        </>
      );
    }

    case "payroll":
      return <PayrollForm key={stamp(settings.payroll)} payroll={settings.payroll} />;

    case "movement":
      return <MovementForm key={stamp(settings.movement)} movement={settings.movement} />;

    case "statuses": {
      const [project, task, pipeline, employment] = await Promise.all([statusUsage("project"), statusUsage("task"), statusUsage("pipeline"), statusUsage("employment")]);
      return (
        <>
          <StatusEditor
            key={stamp(settings.projectStatuses)}
            title="Project statuses"
            description="Lifecycle stages of a project."
            action={saveProjectStatuses}
            items={settings.projectStatuses as StatusRow[]}
            categories={asOptions(PROJECT_CATEGORIES)}
            usage={project}
            noun="projects"
            note="The category tells reports how to treat the status (for example Completed counts as delivered)."
          />
          <StatusEditor
            key={stamp(settings.taskStatuses)}
            title="Task statuses"
            description="Columns on the task board."
            action={saveTaskStatuses}
            items={settings.taskStatuses as StatusRow[]}
            categories={asOptions(TASK_CATEGORIES)}
            usage={task}
            noun="tasks"
            note="Done and Cancelled categories stop a task counting as open work."
          />
          <StatusEditor
            key={stamp(settings.pipelineStages)}
            title="CRM pipeline stages"
            description="Stages a lead moves through, with the chance of winning at each stage."
            action={savePipelineStages}
            items={settings.pipelineStages.map((s) => ({ ...s, probability: String(s.probability) })) as StatusRow[]}
            categories={asOptions(PIPELINE_CATEGORIES)}
            usage={pipeline}
            noun="leads"
            withProbability
            addLabel="Add stage"
          />
          <StatusEditor
            key={stamp(settings.employmentStatuses)}
            title="Employment statuses"
            description="The status shown on every staff record."
            action={saveEmploymentStatuses}
            items={settings.employmentStatuses as StatusRow[]}
            categories={asOptions(EMPLOYMENT_CATEGORIES)}
            usage={employment}
            noun="people"
            note="Exited and Inactive categories remove a person from active lists and pickers."
          />
        </>
      );
    }

    case "lists": {
      const [assets, companyAssets, expenses, leads, docs] = await Promise.all([
        groupCounts(db().select({ key: Asset.category, n: count() }).from(Asset).where(eq(Asset.kind, "staff")).groupBy(Asset.category)),
        groupCounts(db().select({ key: Asset.category, n: count() }).from(Asset).where(eq(Asset.kind, "company")).groupBy(Asset.category)),
        groupCounts(db().select({ key: Expense.category, n: count() }).from(Expense).groupBy(Expense.category)),
        groupCounts(db().select({ key: Lead.source, n: count() }).from(Lead).groupBy(Lead.source)),
        groupCounts(
          db()
            .select({ key: StoredFile.category, n: count() })
            .from(StoredFile)
            .where(and(eq(StoredFile.entityType, "user"), isNull(StoredFile.deletedAt), isNotNull(StoredFile.category)))
            .groupBy(StoredFile.category),
        ),
      ]);
      return (
        <>
          <StringListEditor key={stamp(settings.expenseCategories)} title="Expense categories" description="Offered when claiming an expense." listKey="expenseCategories" items={settings.expenseCategories} usage={expenses} noun="expenses" />
          <StringListEditor key={stamp(settings.assetCategories)} title="Staff asset categories" description="Assets issued to people (laptops, phones…)." listKey="assetCategories" items={settings.assetCategories} usage={assets} noun="assets" />
          <StringListEditor key={stamp(settings.companyAssetCategories)} title="Company asset categories" description="Assets bought for the office itself (AC, inverter…), kept for reporting." listKey="companyAssetCategories" items={settings.companyAssetCategories} usage={companyAssets} noun="assets" />
          <StringListEditor key={stamp(settings.leadSources)} title="Lead sources" description="Where enquiries come from." listKey="leadSources" items={settings.leadSources} usage={leads} noun="leads" />
          <DocumentCategoriesEditor key={stamp(settings.documentCategories)} items={settings.documentCategories} usage={docs} />
        </>
      );
    }

    case "numbering":
      return (
        <>
          <NumberingForm key={stamp(settings.numbering)} numbering={settings.numbering} fiscalYear={fiscalYear()} />
          <TaxesForm key={stamp([settings.taxes, settings.paymentTerms])} taxes={settings.taxes} paymentTerms={settings.paymentTerms} />
          <TemplatesForm key={stamp(settings.documents)} documents={settings.documents} />
        </>
      );

    case "notifications":
      return <NotificationsForm key={stamp(settings.notifications)} notifications={settings.notifications} smtpConfigured={env.smtp.configured} />;

    case "data":
      return <DataSecurityForm key={stamp([settings.data, settings.security])} data={settings.data} security={settings.security} />;

    case "backup": {
      if (!can(user, "backup.manage")) forbidden();
      const backups = await db().select().from(Backup).orderBy(desc(Backup.createdAt)).limit(50);
      const rows: BackupRow[] = backups.map((b) => ({
        id: b._id,
        createdAt: b.createdAt.toISOString(),
        size: b.size,
        trigger: b.trigger,
        status: b.status,
        error: b.error ?? undefined,
        byName: b.byName ?? undefined,
        restoredAt: b.restoredAt?.toISOString(),
        restoredBy: b.restoredBy ?? undefined,
        total: b.collections.reduce((n, c) => n + c.count, 0),
        collections: b.collections.map((c) => ({ name: c.name ?? "", count: c.count ?? 0 })),
      }));
      return <BackupPanel backups={rows} storageConfigured={env.storage.configured} autoBackup={settings.data.autoBackup} retention={settings.data.backupRetentionCount} />;
    }

    default:
      return null;
  }
}
