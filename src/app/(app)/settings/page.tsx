import Link from "next/link";
import { forbidden } from "next/navigation";
import { Segmented } from "@/components/ui/tabs";
import { PageBody, PageHeader } from "@/components/ui/page";
import { can, requirePagePermission, type CurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { fiscalYear } from "@/lib/counters";
import { env } from "@/lib/env";
import { cn } from "@/lib/cn";
import { Asset, Backup, Department, Designation, Expense, Holiday, Lead, LeaveBalance, LeaveRequest, LeaveType, StoredFile, User } from "@/lib/models";
import { namesFor, peopleOptions } from "@/lib/people";
import { param, type SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { todayKey } from "@/lib/time";
import { BackupPanel, type BackupRow } from "./backup-panel";
import { EMPLOYMENT_CATEGORIES, PIPELINE_CATEGORIES, PROJECT_CATEGORIES, SECTIONS, TASK_CATEGORIES } from "./constants";
import { statusUsage } from "./helpers";
import { saveEmploymentStatuses, savePipelineStages, saveProjectStatuses, saveTaskStatuses } from "./actions";
import { DocumentCategoriesEditor, MovementForm, PayrollForm, StatusEditor, StringListEditor, TaxesForm, type StatusRow } from "./list-forms";
import { LinkSelect } from "./ui";
import { DepartmentsCard, DesignationsCard, HolidaysCard, LeaveTypesCard } from "./org-forms";
import { AttendanceForm, CompanyForm, DataSecurityForm, LeaveSettingsForm, NotificationsForm, NumberingForm, TemplatesForm } from "./simple-forms";

export const metadata = { title: "Configuration" };
// Backup / restore run inside server actions of this page and can take a while on large databases.
export const maxDuration = 300;

const humanize = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
const asOptions = (values: readonly string[]) => values.map((value) => ({ value, label: humanize(value) }));

async function groupCounts(rows: PromiseLike<{ _id: string | null; n: number }[]>): Promise<Record<string, number>> {
  return Object.fromEntries((await rows).filter((r) => r._id).map((r) => [r._id as string, r.n]));
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
        <nav aria-label="Settings sections" className="hidden w-56 shrink-0 flex-col gap-0.5 rounded-[14px] border border-line bg-white p-2 lg:flex">
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
  await connectDB();
  const settings = await getSettings();
  const stamp = (v: unknown) => JSON.stringify(v);

  switch (section) {
    case "company":
      return <CompanyForm key={stamp(settings.company)} company={settings.company} storageConfigured={env.spaces.configured} />;

    case "organization": {
      const [depts, desigs, deptPeople, desigPeople, people] = await Promise.all([
        Department.find().sort({ name: 1 }).lean(),
        Designation.find().sort({ level: 1, name: 1 }).lean(),
        groupCounts(User.aggregate([{ $group: { _id: { $toString: "$department" }, n: { $sum: 1 } } }])),
        groupCounts(User.aggregate([{ $group: { _id: { $toString: "$designation" }, n: { $sum: 1 } } }])),
        peopleOptions(),
      ]);
      const heads = await namesFor(depts.map((d) => d.head));
      const deptNames = new Map(depts.map((d) => [d._id.toString(), d.name]));
      const designationCount = new Map<string, number>();
      for (const d of desigs) if (d.department) designationCount.set(d.department.toString(), (designationCount.get(d.department.toString()) ?? 0) + 1);
      return (
        <>
          <DepartmentsCard
            people={people}
            departments={depts.map((d) => ({
              id: d._id.toString(),
              name: d.name,
              code: d.code,
              description: d.description,
              active: d.active,
              head: d.head ? { id: d.head.toString(), name: heads.get(d.head.toString()) ?? "Unknown" } : undefined,
              people: deptPeople[d._id.toString()] ?? 0,
              designations: designationCount.get(d._id.toString()) ?? 0,
            }))}
          />
          <DesignationsCard
            departments={depts.map((d) => ({ id: d._id.toString(), name: d.name }))}
            designations={desigs.map((d) => ({
              id: d._id.toString(),
              name: d.name,
              department: d.department ? { id: d.department.toString(), name: deptNames.get(d.department.toString()) ?? "Unknown" } : undefined,
              level: d.level,
              active: d.active,
              people: desigPeople[d._id.toString()] ?? 0,
            }))}
          />
        </>
      );
    }

    case "attendance":
      return <AttendanceForm key={stamp(settings.attendance)} attendance={settings.attendance} />;

    case "holidays": {
      const current = todayKey().slice(0, 4);
      const asked = param(sp, "year");
      const year = /^\d{4}$/.test(asked) ? asked : current;
      const [holidays, yearRows] = await Promise.all([
        Holiday.find({ date: { $gte: `${year}-01-01`, $lte: `${year}-12-31` } }).sort({ date: 1 }).lean(),
        Holiday.aggregate<{ _id: string }>([{ $group: { _id: { $substr: ["$date", 0, 4] } } }]),
      ]);
      const years = [...new Set([...yearRows.map((r) => r._id), String(Number(current) - 1), current, String(Number(current) + 1), year])].sort();
      return (
        <>
          <Segmented className="self-start" items={years.map((y) => ({ href: `/settings?section=holidays&year=${y}`, label: y, active: y === year }))} />
          <HolidaysCard key={year + stamp(holidays.map((h) => [h.date, h.name, h.optional]))} year={year} holidays={holidays.map((h) => ({ id: h._id.toString(), date: h.date, name: h.name, optional: h.optional }))} />
        </>
      );
    }

    case "leave": {
      const [types, requests, adjusted] = await Promise.all([
        LeaveType.find().sort({ order: 1, name: 1 }).lean(),
        groupCounts(LeaveRequest.aggregate([{ $group: { _id: { $toString: "$leaveType" }, n: { $sum: 1 } } }])),
        groupCounts(
          LeaveBalance.aggregate([
            { $match: { $or: [{ carriedForward: { $ne: 0 } }, { adjustment: { $ne: 0 } }, { quotaOverride: { $exists: true } }, { "notes.0": { $exists: true } }] } },
            { $group: { _id: { $toString: "$leaveType" }, n: { $sum: 1 } } },
          ]),
        ),
      ]);
      const views = types.map((t) => ({
        id: t._id.toString(),
        name: t.name,
        code: t.code,
        color: t.color,
        annualQuota: t.annualQuota,
        accrual: t.accrual,
        carryForward: t.carryForward,
        maxCarryForward: t.maxCarryForward,
        paid: t.paid,
        allowHalfDay: t.allowHalfDay,
        requiresHrApproval: t.requiresHrApproval,
        requiresAttachmentAfterDays: t.requiresAttachmentAfterDays,
        applicableTo: t.applicableTo,
        active: t.active,
        order: t.order,
        inUse: (requests[t._id.toString()] ?? 0) > 0 || (adjusted[t._id.toString()] ?? 0) > 0,
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
      const [assets, expenses, leads, docs] = await Promise.all([
        groupCounts(Asset.aggregate([{ $group: { _id: "$category", n: { $sum: 1 } } }])),
        groupCounts(Expense.aggregate([{ $group: { _id: "$category", n: { $sum: 1 } } }])),
        groupCounts(Lead.aggregate([{ $group: { _id: "$source", n: { $sum: 1 } } }])),
        groupCounts(StoredFile.aggregate([{ $match: { entityType: "user", deletedAt: null, category: { $exists: true } } }, { $group: { _id: "$category", n: { $sum: 1 } } }])),
      ]);
      return (
        <>
          <StringListEditor key={stamp(settings.expenseCategories)} title="Expense categories" description="Offered when claiming an expense." listKey="expenseCategories" items={settings.expenseCategories} usage={expenses} noun="expenses" />
          <StringListEditor key={stamp(settings.assetCategories)} title="Asset categories" description="Used to classify company assets." listKey="assetCategories" items={settings.assetCategories} usage={assets} noun="assets" />
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
      const backups = await Backup.find().sort({ createdAt: -1 }).limit(50).lean();
      const rows: BackupRow[] = backups.map((b) => ({
        id: b._id.toString(),
        createdAt: b.createdAt.toISOString(),
        size: b.size,
        trigger: b.trigger,
        status: b.status,
        error: b.error,
        byName: b.byName,
        restoredAt: b.restoredAt?.toISOString(),
        restoredBy: b.restoredBy,
        total: b.collections.reduce((n, c) => n + c.count, 0),
        collections: b.collections.map((c) => ({ name: c.name ?? "", count: c.count ?? 0 })),
      }));
      return <BackupPanel backups={rows} storageConfigured={env.spaces.configured} autoBackup={settings.data.autoBackup} retention={settings.data.backupRetentionCount} />;
    }

    default:
      return null;
  }
}
