import Link from "next/link";
import { can, requirePagePermission } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Client, Lead, Project } from "@/lib/models";
import { namesFor, peopleOptions } from "@/lib/people";
import { param, type SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { cn } from "@/lib/cn";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { Chip, OptionChip, StatusChip, Tag } from "@/components/ui/chip";
import { Alert, PageBody, PageHeader } from "@/components/ui/page";
import { Timeline, type TimelineItem } from "@/components/ui/timeline";
import { daysUntil } from "@/app/(app)/crm/_lib/clock";
import { pageProposal } from "../_lib/access";
import { contentForVersion } from "../_lib/content";
import { ProposalActions } from "../proposal-actions";
import { ProposalDocument } from "../proposal-document";

export const metadata = { title: "Proposal" };

const HISTORY_TITLES: Record<string, string> = {
  created: "Created",
  updated: "Edited",
  revised: "Revised",
  sent: "Sent to client",
  negotiation: "Moved to negotiation",
  approved: "Approved — client accepted",
  rejected: "Rejected",
  reopened: "Reopened for negotiation",
  converted: "Converted to project",
  expired: "Expired",
};

export default async function ProposalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requirePagePermission("proposals.view");
  const p = await pageProposal(user, id);
  await connectDB();
  const settings = await getSettings();

  const revParam = Number.parseInt(param(sp, "rev"), 10);
  const { content, version, isCurrent } = contentForVersion(p, Number.isFinite(revParam) ? revParam : undefined);

  const canManage = can(user, "proposals.manage");
  const canApprove = can(user, "proposals.approve");
  const [client, lead, project, names, people] = await Promise.all([
    Client.findById(p.client, { name: 1, clientNo: 1, contactPerson: 1, email: 1 }).lean(),
    p.lead ? Lead.findById(p.lead, { leadNo: 1, title: 1 }).lean() : null,
    p.project ? Project.findById(p.project, { projectNo: 1, title: 1, status: 1 }).lean() : null,
    namesFor([p.owner, p.createdBy, p.approvedBy]),
    canApprove && p.status === "approved" && !p.project ? peopleOptions() : [],
  ]);

  const left = daysUntil(content.validUntil);
  const open = p.status === "sent" || p.status === "negotiation";
  const expiryTone = open && left !== null && left <= 3;

  const revisions = [...p.revisions].sort((a, b) => b.version - a.version);
  const historyItems: TimelineItem[] = [...p.history]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .map((h, i) => ({
      id: h._id?.toString() ?? String(i),
      title: HISTORY_TITLES[h.action] ?? h.action,
      meta: h.byName,
      at: h.at,
      body: h.note,
      tone: h.action === "approved" ? "success" : h.action === "rejected" ? "danger" : h.action === "expired" ? "warning" : "default",
    }));
  const pdfHref = `/api/pdf/proposal/${id}${isCurrent ? "" : `?rev=${version}`}`;

  return (
    <PageBody>
      <PageHeader
        back={{ href: "/proposals", label: "Proposals" }}
        title={content.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-muted">{p.proposalNo}</span>
            <StatusChip domain="proposal" value={p.status} />
            <Tag tone="gray">v{version}</Tag>
            <Tag tone="blue" className="capitalize">
              {p.kind}
            </Tag>
          </span>
        }
        actions={
          isCurrent ? (
            <ProposalActions id={id} status={p.status} hasProject={Boolean(p.project)} canManage={canManage} canApprove={canApprove} people={people} pdfHref={pdfHref} />
          ) : (
            <ButtonLink href={`/proposals/${id}`} variant="secondary">
              Back to current version
            </ButtonLink>
          )
        }
      />

      {!isCurrent && (
        <Alert tone="info" title={`Version ${version} (read-only).`}>
          This is an earlier version, kept for the record. <Link href={`/proposals/${id}`} className="font-semibold underline underline-offset-2">View the current version (v{p.version})</Link> or{" "}
          <a href={pdfHref} className="font-semibold underline underline-offset-2" target="_blank" rel="noopener noreferrer">download this version as PDF</a>.
        </Alert>
      )}
      {isCurrent && p.status === "approved" && !p.project && (
        <Alert tone="success" title="Approved by the client.">
          {canApprove ? "Convert it to a project to create the milestones and billing schedule." : "Someone with proposal approval access can convert it to a project."}
        </Alert>
      )}
      {isCurrent && p.status === "expired" && (
        <Alert tone="warning" title="This proposal expired.">
          The validity date passed before the client decided. Reopen it to revise and send again.
        </Alert>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <ProposalDocument content={content} />
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title="Status" />
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
                    ) : undefined,
                  },
                  ...(lead
                    ? [{ label: "Lead", value: <Link href={`/crm/leads/${lead._id}`} className="font-medium text-brand-600 hover:text-brand-800">{lead.leadNo} · {lead.title}</Link> }]
                    : []),
                  { label: "Owner", value: p.owner ? names.get(p.owner.toString()) : undefined },
                  { label: "Created", value: `${fmtDate(p.createdAt)}${p.createdBy ? ` · ${names.get(p.createdBy.toString()) ?? ""}` : ""}` },
                  { label: "Sent", value: p.sentAt ? fmtDateTime(p.sentAt) : "Not sent yet" },
                  {
                    label: "Valid until",
                    value: content.validUntil ? (
                      <span className={cn(expiryTone && "font-semibold text-warning")}>
                        {fmtDate(content.validUntil)}
                        {open && left !== null ? (left < 0 ? " · expired" : left === 0 ? " · expires today" : ` · ${left} day${left === 1 ? "" : "s"} left`) : ""}
                      </span>
                    ) : undefined,
                  },
                  ...(p.status === "approved" || p.status === "converted"
                    ? [{ label: "Approved", value: `${p.approvedByName ?? "—"}${p.decidedAt ? ` · ${fmtDate(p.decidedAt)}` : ""}${p.decisionNote ? ` — ${p.decisionNote}` : ""}` }]
                    : []),
                  ...(p.status === "rejected" ? [{ label: "Rejection reason", value: p.decisionNote }] : []),
                  ...(project
                    ? [
                        {
                          label: "Project",
                          value: (
                            <span className="flex flex-wrap items-center gap-2">
                              <Link href={`/projects/${project._id}`} className="font-medium text-brand-600 hover:text-brand-800">
                                {project.projectNo} · {project.title}
                              </Link>
                              <OptionChip options={settings.projectStatuses} value={project.status} />
                            </span>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Versions" />
            <CardBody className="flex flex-col">
              <VersionRow href={`/proposals/${id}`} label={`v${p.version} · current`} date={fmtDate(p.updatedAt)} active={isCurrent} />
              {revisions.map((r) => (
                <VersionRow key={r.version} href={`/proposals/${id}?rev=${r.version}`} label={`v${r.version}`} date={fmtDate(r.at)} note={r.note} by={r.byName} active={!isCurrent && version === r.version} />
              ))}
              {revisions.length === 0 && <p className="border-t border-line-soft pt-3 text-[13px] text-muted">No earlier versions. Editing a proposal after it has been sent keeps the previous version here.</p>}
            </CardBody>
          </Card>

          {p.status !== "converted" && (
            <section className="flex flex-col gap-2 rounded-[14px] bg-navy p-5 text-white">
              <h2 className="font-display text-base font-semibold">When the client approves</h2>
              <p className="text-[13px] leading-relaxed text-[#E3E9FC]">
                One click creates the project with {content.paymentMilestones.length > 0 ? `its ${content.paymentMilestones.length} milestone${content.paymentMilestones.length === 1 ? "" : "s"} and a matching billing schedule` : "the scope, dates and budget"} — no re-typing.
              </p>
              {p.status !== "approved" && <Chip tone="gray" dot={false} className="self-start">Available after approval</Chip>}
            </section>
          )}

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

function VersionRow({ href, label, date, note, by, active }: { href: string; label: string; date: string; note?: string; by?: string; active: boolean }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cn("block border-t border-line-soft py-2.5 text-[13px] first:border-t-0 hover:bg-field", active && "bg-brand-50")}>
      <div className="flex justify-between gap-2 px-1">
        <strong className="font-semibold text-ink">{label}</strong>
        <span className="text-muted">{date}</span>
      </div>
      {(note || by) && <div className="mt-0.5 px-1 text-muted">{[note, by].filter(Boolean).join(" · ")}</div>}
    </Link>
  );
}
