import Link from "next/link";
import { Check, Pencil, Plus } from "lucide-react";
import { can, requirePagePermission } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Activity, Client, Project, Proposal } from "@/lib/models";
import { namesFor, peopleOptions } from "@/lib/people";
import { getSettings } from "@/lib/settings";
import { optionLabel } from "@/lib/status";
import { inr } from "@/lib/format";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { cn } from "@/lib/cn";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { OptionChip, StatusChip } from "@/components/ui/chip";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Timeline, type TimelineItem } from "@/components/ui/timeline";
import { addAttachments, removeAttachment } from "../../actions";
import { pageLead } from "../../_lib/access";
import { isPast } from "../../_lib/clock";
import { openStages } from "../../_lib/pipeline";
import { ActivityComposer } from "../../_components/activity-composer";
import { ActivityFeed, type FeedItem } from "../../_components/activity-feed";
import { AttachmentsPanel } from "../../_components/attachments-panel";
import { DeleteRecord } from "../../_components/delete-record";
import { LeadStageMenu } from "../../_components/lead-stage-menu";

export const metadata = { title: "Lead" };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePagePermission("crm.view");
  const lead = await pageLead(user, id);
  await connectDB();
  const settings = await getSettings();
  const stages = settings.pipelineStages;
  const canManage = can(user, "crm.manage");
  const canCreateProposal = can(user, "proposals.manage");

  const [client, activities, proposals, project, people] = await Promise.all([
    lead.client ? Client.findById(lead.client, { name: 1, clientNo: 1, confidential: 1 }).lean() : null,
    Activity.find({ lead: lead._id }).sort({ at: -1 }).limit(200).lean(),
    can(user, "proposals.view") ? Proposal.find({ lead: lead._id }, { proposalNo: 1, title: 1, status: 1, version: 1, total: 1, kind: 1 }).sort({ createdAt: -1 }).lean() : [],
    lead.project ? Project.findById(lead.project, { projectNo: 1, title: 1, status: 1 }).lean() : null,
    canManage ? peopleOptions() : [],
  ]);
  const names = await namesFor([lead.assignedTo, lead.createdBy, ...activities.map((a) => a.assignedTo)]);

  const feed: FeedItem[] = activities.map((a) => ({
    id: a._id.toString(),
    type: a.type,
    subject: a.subject,
    notes: a.notes,
    at: a.at,
    dueAt: a.dueAt,
    done: a.done,
    doneAt: a.doneAt,
    outcome: a.outcome,
    byName: a.byName,
    assigneeName: a.assignedTo ? names.get(a.assignedTo.toString()) : undefined,
    canComplete: canManage || [a.assignedTo, a.by].some((p) => p?.toString() === user.id),
  }));

  // Stage stepper
  const open = openStages(stages);
  const lostFrom = [...lead.history].reverse().find((h) => h.action === "lost");
  const activeStage = lead.status === "lost" ? lostFrom?.from : lead.stage;
  const activeIdx = lead.status === "won" ? open.length : open.findIndex((s) => s.key === activeStage);
  const lostNote = lostFrom?.note;

  const historyItems: TimelineItem[] = [...lead.history]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .map((h, i) => {
      const label = (k?: string) => (k ? optionLabel(stages, k) : "—");
      const base = { id: h._id?.toString() ?? String(i), meta: h.byName, at: h.at };
      switch (h.action) {
        case "created":
          return { ...base, title: "Lead created" };
        case "stage":
          return { ...base, title: `Moved from ${label(h.from)} to ${label(h.to)}` };
        case "assigned":
          return { ...base, title: `Reassigned from ${h.from ?? "—"} to ${h.to ?? "—"}` };
        case "won":
          return { ...base, title: "Marked won", tone: "success" as const, body: h.note };
        case "lost":
          return { ...base, title: "Marked lost", tone: "danger" as const, body: h.note };
        case "reopened":
          return { ...base, title: `Reopened in ${label(h.to)}`, tone: "warning" as const };
        default:
          return { ...base, title: h.action, body: h.note };
      }
    });

  const followUpOverdue = lead.status === "open" && isPast(lead.nextFollowUp);
  const stageOptions = stages.map((s) => ({ key: s.key, label: s.label, category: s.category }));

  return (
    <PageBody>
      <PageHeader
        back={{ href: "/crm", label: "Leads & pipeline" }}
        title={lead.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-muted">{lead.leadNo}</span>
            <StatusChip domain="leadStatus" value={lead.status} />
            <OptionChip options={stages} value={lead.stage} />
          </span>
        }
        actions={
          <>
            {canManage && lead.status !== "won" && (
              <LeadStageMenu
                leadId={id}
                status={lead.status}
                stage={lead.stage}
                stages={stageOptions}
                canCreateProposal={canCreateProposal}
                trigger={<Button variant="secondary">{lead.status === "open" ? "Move stage" : "Reopen"}</Button>}
              />
            )}
            {canManage && (
              <ButtonLink href={`/crm/leads/${id}/edit`} variant="secondary" icon={<Pencil className="size-4" aria-hidden />}>
                Edit
              </ButtonLink>
            )}
            {canCreateProposal && lead.status !== "lost" && (
              <ButtonLink href={`/proposals/new?lead=${id}`} icon={<Plus className="size-4" aria-hidden />}>
                Create proposal
              </ButtonLink>
            )}
            {can(user, "crm.delete") && <DeleteRecord kind="lead" id={id} name={`lead ${lead.leadNo}`} redirectTo="/crm" />}
          </>
        }
      />

      <Card>
        <ol className="flex flex-wrap items-center gap-1 px-4 py-3 sm:px-5 sm:py-4" aria-label="Pipeline stage">
          {open.map((s, i) => {
            const done = i < activeIdx;
            const current = i === activeIdx && lead.status !== "won";
            return (
              <li key={s.key} className="flex shrink-0 items-center gap-1" aria-current={current ? "step" : undefined}>
                <span
                  className={cn(
                    "flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold whitespace-nowrap",
                    current && lead.status === "open" && "bg-brand-600 text-white",
                    current && lead.status === "lost" && "bg-danger-bg text-danger",
                    done && "bg-tone-green-bg text-tone-green",
                    !done && !current && "bg-track text-muted",
                  )}
                >
                  {done && <Check className="size-3.5" aria-hidden />}
                  {s.label}
                </span>
                {i < open.length - 1 && <span className="h-px w-4 bg-line-strong" aria-hidden />}
              </li>
            );
          })}
          {lead.status !== "open" && (
            <li className="flex shrink-0 items-center gap-1">
              <span className="h-px w-4 bg-line-strong" aria-hidden />
              <span className={cn("rounded-full px-3 py-1.5 text-xs font-semibold", lead.status === "won" ? "bg-success text-white" : "bg-danger text-white")}>
                {lead.status === "won" ? "Won" : "Lost"}
              </span>
            </li>
          )}
        </ol>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader title="Activity" subtitle="Calls, meetings, emails, WhatsApp, notes and follow-ups" />
            {canManage && (
              <div className="border-b border-line-soft px-5 pb-4">
                <ActivityComposer lead={id} client={lead.client?.toString()} people={people} currentUserId={user.id} />
              </div>
            )}
            <ActivityFeed items={feed} />
          </Card>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DetailList
                columns={1}
                items={[
                  {
                    label: "Client",
                    value: client ? (
                      <Link href={`/crm/clients/${client._id}`} className="font-medium text-brand-600 hover:text-brand-800">
                        {client.name} · {client.clientNo}
                      </Link>
                    ) : (
                      <span>
                        {lead.companyName} <span className="text-muted">(not yet a client)</span>
                      </span>
                    ),
                  },
                  { label: "Contact", value: lead.contactName },
                  { label: "Email", value: lead.email ? <a href={`mailto:${lead.email}`} className="text-brand-600 hover:text-brand-800">{lead.email}</a> : undefined },
                  { label: "Phone", value: lead.phone ? <a href={`tel:${lead.phone}`} className="text-brand-600 hover:text-brand-800">{lead.phone}</a> : undefined },
                  { label: "Source", value: lead.source },
                  { label: "Owner", value: lead.assignedTo ? names.get(lead.assignedTo.toString()) : "Unassigned" },
                  { label: "Expected value", value: lead.expectedValue ? inr(lead.expectedValue) : undefined },
                  { label: "Client budget", value: lead.budget ? inr(lead.budget) : undefined },
                  { label: "Expected close", value: lead.expectedCloseDate ? fmtDate(lead.expectedCloseDate) : undefined },
                  ...(lead.status === "open"
                    ? [{ label: "Next follow-up", value: lead.nextFollowUp ? <span className={cn(followUpOverdue && "font-semibold text-danger")}>{fmtDateTime(lead.nextFollowUp)}{followUpOverdue ? " · overdue" : ""}</span> : undefined }]
                    : []),
                  ...(lead.status === "lost" ? [{ label: "Lost reason", value: lostNote ?? lead.lostReason }] : []),
                  ...(lead.closedAt ? [{ label: lead.status === "won" ? "Won on" : "Lost on", value: fmtDate(lead.closedAt) }] : []),
                  { label: "Created", value: `${fmtDate(lead.createdAt)}${lead.createdBy ? ` · ${names.get(lead.createdBy.toString()) ?? ""}` : ""}` },
                ]}
              />
              {lead.requirement && (
                <div className="mt-4 border-t border-line-soft pt-4">
                  <div className="text-xs font-medium text-muted">Requirement</div>
                  <p className="mt-1 text-sm leading-relaxed whitespace-pre-line text-ink-2">{lead.requirement}</p>
                </div>
              )}
            </CardBody>
          </Card>

          {(proposals.length > 0 || project) && (
            <Card>
              <CardHeader title="Linked work" />
              <CardBody className="flex flex-col gap-2">
                {proposals.map((p) => (
                  <Link key={p._id.toString()} href={`/proposals/${p._id}`} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-[13px] hover:border-brand-200 hover:bg-brand-50">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">
                        {p.proposalNo} · {p.title}
                      </span>
                      <span className="text-xs text-muted">
                        v{p.version} · {inr(p.total)}
                      </span>
                    </span>
                    <StatusChip domain="proposal" value={p.status} />
                  </Link>
                ))}
                {project && (
                  <Link href={`/projects/${project._id}`} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-[13px] hover:border-brand-200 hover:bg-brand-50">
                    <span className="min-w-0 truncate font-medium text-ink">
                      {project.projectNo} · {project.title}
                    </span>
                    <OptionChip options={settings.projectStatuses} value={project.status} />
                  </Link>
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Attachments" />
            <CardBody>
              <AttachmentsPanel
                entityType="lead"
                entityId={id}
                add={addAttachments.bind(null, "lead", id)}
                remove={removeAttachment.bind(null, "lead", id)}
                canManage={canManage}
                confidential={Boolean(client?.confidential)}
                files={lead.attachments.map((a) => ({ refId: a._id?.toString() ?? a.file.toString(), file: a.file.toString(), name: a.name, size: a.size }))}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="History" />
            <CardBody>
              <Timeline items={historyItems} />
            </CardBody>
          </Card>
        </aside>
      </div>
    </PageBody>
  );
}
