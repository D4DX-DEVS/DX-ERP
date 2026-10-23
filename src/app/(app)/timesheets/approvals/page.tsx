import { forbidden } from "next/navigation";
import { Check, RotateCcw, X } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Project, Task, TimesheetEntry } from "@/lib/models";
import { peopleOptions } from "@/lib/people";
import { pageParam, PAGE_SIZE, param, type SearchParams } from "@/lib/query";
import { fmtDate, fmtDateTime, formatDuration } from "@/lib/time";
import { peopleMap, projectFilter, timesheetScope, type Filter } from "@/lib/work-access";
import { ActionButton, ReasonAction } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusChip, Tag } from "@/components/ui/chip";
import { Pagination } from "@/components/ui/filters";
import { EmptyState, PageBody, PageHeader } from "@/components/ui/page";
import { EmptyRow, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { LinkTabs } from "@/components/ui/tabs";
import { weekRange } from "../week";
import { approveEntries, rejectEntries, reopenEntry } from "./actions";
import { ExportDialog } from "./export-dialog";

export const metadata = { title: "Timesheet approvals" };

export default async function TimesheetApprovalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;
  await connectDB();
  const [approveScope, viewScope] = await Promise.all([timesheetScope(user, "approve"), timesheetScope(user, "view")]);
  if (!viewScope.hasAccess) forbidden();
  const tab = param(sp, "tab") === "history" ? "history" : "pending";

  const pendingFilter: Filter = { $and: [approveScope.filter, { status: "submitted" }] };
  const pendingTotal = approveScope.hasAccess ? await TimesheetEntry.countDocuments(pendingFilter) : 0;

  const [people, projects] = await Promise.all([peopleOptions({ includeExited: true }), Project.find(projectFilter(user), { projectNo: 1, title: 1 }).sort({ projectNo: -1 }).limit(300).lean()]);

  return (
    <PageBody>
      <PageHeader
        overline="Time"
        title="Timesheet approvals"
        description="Review submitted time by person and week. You can't review your own time."
        actions={<ExportDialog people={people.map((p) => ({ id: p.id, name: p.name }))} projects={projects.map((p) => ({ id: p._id.toString(), label: `${p.projectNo} · ${p.title}` }))} />}
      />
      <LinkTabs
        items={[
          { href: "/timesheets/approvals", label: "Waiting for review", count: pendingTotal || undefined, active: tab === "pending" },
          { href: "/timesheets/approvals?tab=history", label: "History", active: tab === "history" },
        ]}
      />
      {tab === "pending" ? <PendingTab filter={pendingFilter} allowed={approveScope.hasAccess} /> : <HistoryTab sp={sp} viewScope={viewScope} approveScope={approveScope} />}
    </PageBody>
  );
}

type Scope = Awaited<ReturnType<typeof timesheetScope>>;

async function labelsFor(entries: { project?: { toString(): string } | null; task?: { toString(): string } | null }[]) {
  const projectIds = [...new Set(entries.map((e) => e.project?.toString()).filter(Boolean) as string[])];
  const taskIds = [...new Set(entries.map((e) => e.task?.toString()).filter(Boolean) as string[])];
  const [projects, tasks] = await Promise.all([
    projectIds.length ? Project.find({ _id: { $in: projectIds } }, { projectNo: 1, title: 1 }).lean() : [],
    taskIds.length ? Task.find({ _id: { $in: taskIds } }, { taskNo: 1, title: 1 }).lean() : [],
  ]);
  return {
    project: new Map(projects.map((p) => [p._id.toString(), `${p.projectNo} · ${p.title}`])),
    task: new Map(tasks.map((t) => [t._id.toString(), `${t.taskNo} · ${t.title}`])),
  };
}

async function PendingTab({ filter, allowed }: { filter: Filter; allowed: boolean }) {
  if (!allowed) {
    return (
      <Card>
        <EmptyState title="Nothing to approve" description="You can view timesheet history and export, but you aren't a reviewer. Project managers and reporting managers review their own people." />
      </Card>
    );
  }
  const entries = await TimesheetEntry.find(filter).sort({ weekStart: -1, date: 1, createdAt: 1 }).limit(500).lean();
  if (entries.length === 0) {
    return (
      <Card>
        <EmptyState title="All caught up" description="No submitted timesheets are waiting for your review." />
      </Card>
    );
  }
  const [names, labels] = await Promise.all([peopleMap(entries.map((e) => e.user)), labelsFor(entries)]);

  const groups = new Map<string, typeof entries>();
  for (const e of entries) {
    const key = `${e.user}|${e.weekStart}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  return (
    <div className="flex flex-col gap-4">
      {[...groups.entries()].map(([key, list]) => {
        const first = list[0];
        const total = list.reduce((s, e) => s + e.minutes, 0);
        const billable = list.filter((e) => e.billable).reduce((s, e) => s + e.minutes, 0);
        const ids = list.map((e) => e._id.toString());
        const name = names.get(first.user.toString())?.name ?? "Unknown";
        return (
          <Card key={key}>
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <h2 className="font-sans text-[15px] font-semibold text-ink">{name}</h2>
                <p className="text-[13px] text-muted">
                  {weekRange(first.weekStart)} · {list.length} {list.length === 1 ? "entry" : "entries"} · {formatDuration(total)} ({formatDuration(billable)} billable)
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ReasonAction
                  action={rejectEntries.bind(null, ids)}
                  title={`Reject ${name}'s week`}
                  description="All entries in this group go back to the employee with your reason."
                  label="Reason"
                  confirmLabel="Reject all"
                  confirmVariant="danger"
                  successMessage="Entries rejected"
                  trigger={<Button variant="danger-outline" icon={<X className="size-4" aria-hidden />}>Reject all</Button>}
                />
                <ActionButton action={approveEntries.bind(null, ids)} variant="success" icon={<Check className="size-4" aria-hidden />} successMessage="Timesheet approved">
                  Approve all
                </ActionButton>
              </div>
            </div>
            <TableWrap phone={[1, 4, 5]} tablet={[1, 2, 4, 5]}>
              <THead>
                <Th>Date</Th>
                <Th>Project · task</Th>
                <Th>Description</Th>
                <Th align="right">Duration</Th>
                <Th align="right">Review</Th>
              </THead>
              <tbody>
                {list.map((e) => (
                  <Tr key={e._id.toString()}>
                    <Td className="whitespace-nowrap">{fmtDate(e.date, "EEE d MMM")}</Td>
                    <Td className="max-w-[260px]">
                      <span className="block truncate font-medium">{e.task ? labels.task.get(e.task.toString()) : "General work"}</span>
                      <span className="block truncate text-xs text-muted">{e.project ? labels.project.get(e.project.toString()) : "No project"}</span>
                    </Td>
                    <Td className="max-w-[320px]">
                      <span className="block text-[13px] text-ink-2">{e.description}</span>
                      <Tag tone={e.billable ? "green" : "gray"} className="mt-1">
                        {e.billable ? "Billable" : "Non-billable"}
                      </Tag>
                    </Td>
                    <Td align="right" className="font-semibold whitespace-nowrap">
                      {formatDuration(e.minutes)}
                    </Td>
                    <Td align="right">
                      <span className="inline-flex items-center gap-1">
                        <ReasonAction
                          action={rejectEntries.bind(null, [e._id.toString()])}
                          title="Reject entry"
                          description={`${fmtDate(e.date, "EEE d MMM")} · ${formatDuration(e.minutes)}`}
                          confirmLabel="Reject"
                          confirmVariant="danger"
                          successMessage="Entry rejected"
                          trigger={
                            <Button variant="ghost" size="icon-sm" aria-label="Reject entry">
                              <X className="size-4 text-danger" aria-hidden />
                            </Button>
                          }
                        />
                        <ActionButton action={approveEntries.bind(null, [e._id.toString()])} variant="ghost" size="icon-sm" aria-label="Approve entry" successMessage="Entry approved">
                          <Check className="size-4 text-success" aria-hidden />
                        </ActionButton>
                      </span>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>
        );
      })}
    </div>
  );
}

async function HistoryTab({ sp, viewScope, approveScope }: { sp: SearchParams; viewScope: Scope; approveScope: Scope }) {
  const page = pageParam(sp);
  const filter: Filter = { $and: [viewScope.all ? {} : viewScope.filter, { status: { $in: ["approved", "rejected"] } }] };
  const [entries, total] = await Promise.all([
    TimesheetEntry.find(filter)
      .sort({ reviewedAt: -1, _id: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
    TimesheetEntry.countDocuments(filter),
  ]);
  const [names, labels] = await Promise.all([peopleMap(entries.map((e) => e.user)), labelsFor(entries)]);
  return (
    <Card>
      <TableWrap phone={[1, 4, "last"]} tablet={[1, 2, 4, 5, "last"]}>
        <THead>
          <Th>Person</Th>
          <Th>Date</Th>
          <Th>Project · task</Th>
          <Th align="right">Duration</Th>
          <Th>Decision</Th>
          <Th>Correction history</Th>
          <Th align="right">Actions</Th>
        </THead>
        <tbody>
          {entries.length === 0 && <EmptyRow colSpan={7}>No reviewed timesheets yet.</EmptyRow>}
          {entries.map((e) => (
            <Tr key={e._id.toString()} className="align-top">
              <Td className="font-medium whitespace-nowrap">{names.get(e.user.toString())?.name ?? "Unknown"}</Td>
              <Td className="whitespace-nowrap">
                {fmtDate(e.date, "EEE d MMM")}
                <span className="block text-xs text-muted">{weekRange(e.weekStart)}</span>
              </Td>
              <Td className="max-w-[240px]">
                <span className="block truncate font-medium">{e.task ? labels.task.get(e.task.toString()) : "General work"}</span>
                <span className="block truncate text-xs text-muted">{e.project ? labels.project.get(e.project.toString()) : "No project"}</span>
              </Td>
              <Td align="right" className="font-semibold whitespace-nowrap">
                {formatDuration(e.minutes)}
              </Td>
              <Td className="max-w-[220px]">
                <StatusChip domain="timesheet" value={e.status} size="sm" />
                <span className="mt-1 block text-xs text-muted">
                  {e.reviewerName ?? "—"}
                  {e.reviewedAt ? ` · ${fmtDateTime(e.reviewedAt)}` : ""}
                </span>
                {e.reviewNote && <span className="block text-xs text-ink-2">{e.reviewNote}</span>}
              </Td>
              <Td className="max-w-[260px]">
                {e.history.filter((h) => h.action.toLowerCase().includes("reopen") || h.action.toLowerCase().includes("edit")).length === 0 ? (
                  <span className="text-xs text-muted">—</span>
                ) : (
                  <ul className="flex flex-col gap-1 text-xs text-ink-2">
                    {e.history
                      .filter((h) => h.action.toLowerCase().includes("reopen") || h.action.toLowerCase().includes("edit"))
                      .map((h, i) => (
                        <li key={i}>
                          {fmtDate(h.at, "d MMM")} · {h.byName ?? "System"} · {h.action}
                          {h.note ? ` — ${h.note}` : ""}
                        </li>
                      ))}
                  </ul>
                )}
              </Td>
              <Td align="right">
                {e.status === "approved" && approveScope.includes(e) && (
                  <ReasonAction
                    action={reopenEntry.bind(null, e._id.toString())}
                    title="Reopen entry"
                    description="The entry returns to draft so the employee can correct and resubmit it. Your reason is kept in its correction history."
                    label="Reason for reopening"
                    confirmLabel="Reopen"
                    successMessage="Entry reopened"
                    trigger={
                      <Button variant="secondary" size="sm" icon={<RotateCcw className="size-3.5" aria-hidden />}>
                        Reopen
                      </Button>
                    }
                  />
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableWrap>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
    </Card>
  );
}
