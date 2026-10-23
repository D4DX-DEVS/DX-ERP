import Link from "next/link";
import { Lock } from "lucide-react";
import { can, requirePagePermission } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Client, Contract, Project, Proposal } from "@/lib/models";
import { namesFor } from "@/lib/people";
import { inr } from "@/lib/format";
import { addDays, fmtDate } from "@/lib/time";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { StatusChip, Tag } from "@/components/ui/chip";
import { Alert, PageBody, PageHeader } from "@/components/ui/page";
import { Timeline, type TimelineItem } from "@/components/ui/timeline";
import { AttachmentsPanel } from "@/app/(app)/crm/_components/attachments-panel";
import { canSeeContractSecrets } from "@/app/(app)/crm/_lib/access";
import { daysUntil, endsWithin } from "@/app/(app)/crm/_lib/clock";
import { addContractFiles, removeContractFile } from "../actions";
import { pageContract } from "../_access";
import { ContractActions } from "../contract-actions";

export const metadata = { title: "Contract" };

const HISTORY_TITLES: Record<string, string> = {
  created: "Created",
  updated: "Edited",
  renewed: "Renewed",
  terminated: "Terminated",
  expired: "Expired",
};

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePagePermission("contracts.view");
  const c = await pageContract(user, id);
  await connectDB();
  const canManage = can(user, "contracts.manage");
  const secrets = canSeeContractSecrets(user, c);

  const [client, project, proposal, renewedFrom, renewedTo, names] = await Promise.all([
    Client.findById(c.client, { name: 1, clientNo: 1 }).lean(),
    c.project ? Project.findById(c.project, { projectNo: 1, title: 1 }).lean() : null,
    c.proposal ? Proposal.findById(c.proposal, { proposalNo: 1, title: 1 }).lean() : null,
    c.renewedFrom ? Contract.findById(c.renewedFrom, { contractNo: 1 }).lean() : null,
    c.status === "renewed" ? Contract.findOne({ renewedFrom: c._id }, { contractNo: 1 }).lean() : null,
    namesFor([c.createdBy]),
  ]);

  const left = daysUntil(c.endDate);
  const expiring = c.status === "active" && endsWithin(c.endDate, c.renewalReminderDays);
  const history: TimelineItem[] = [...c.history]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .map((h, i) => ({
      id: h._id?.toString() ?? String(i),
      title: HISTORY_TITLES[h.action] ?? h.action,
      meta: h.byName ?? "System",
      at: h.at,
      body: h.note,
      tone: h.action === "terminated" ? "danger" : h.action === "expired" ? "warning" : "default",
    }));

  return (
    <PageBody>
      <PageHeader
        back={{ href: "/contracts", label: "Contracts" }}
        title={c.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-muted">{c.contractNo}</span>
            <StatusChip domain="contract" value={c.status} />
            {expiring && <Tag tone="amber">Expiring soon</Tag>}
            {c.confidential && (
              <Tag tone="gray" className="gap-1">
                <Lock className="size-3" aria-hidden /> Confidential
              </Tag>
            )}
            {c.type && <Tag tone="gray">{c.type}</Tag>}
          </span>
        }
        actions={
          canManage && (
            <ContractActions
              id={id}
              status={c.status}
              defaults={{ start: c.endDate ? addDays(c.endDate, 1) : "", end: c.endDate ? addDays(c.endDate, 365) : "", value: c.value ? String(c.value) : "" }}
            />
          )
        }
      />

      {expiring && left !== null && (
        <Alert tone="warning" title={left === 0 ? "Ends today." : `Ends in ${left} day${left === 1 ? "" : "s"}.`}>
          Renew the contract before {fmtDate(c.endDate)} to keep the engagement covered.
        </Alert>
      )}
      {c.status === "expired" && (
        <Alert tone="danger" title="This contract has expired.">
          {canManage ? "Renew it to create the next term, or leave it for the record." : "Ask someone who manages contracts to renew it."}
        </Alert>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DetailList
                items={[
                  {
                    label: "Client",
                    value: client ? (
                      <Link href={`/crm/clients/${client._id}`} className="font-medium text-brand-600 hover:text-brand-800">
                        {client.name} · {client.clientNo}
                      </Link>
                    ) : undefined,
                  },
                  { label: "Type", value: c.type },
                  {
                    label: "Project",
                    value: project ? (
                      <Link href={`/projects/${project._id}`} className="font-medium text-brand-600 hover:text-brand-800">
                        {project.projectNo} · {project.title}
                      </Link>
                    ) : undefined,
                  },
                  {
                    label: "Proposal",
                    value: proposal ? (
                      <Link href={`/proposals/${proposal._id}`} className="font-medium text-brand-600 hover:text-brand-800">
                        {proposal.proposalNo} · {proposal.title}
                      </Link>
                    ) : undefined,
                  },
                  { label: "Start", value: c.startDate ? fmtDate(c.startDate) : undefined },
                  { label: "End", value: c.endDate ? `${fmtDate(c.endDate)}${c.status === "active" && left !== null ? (left < 0 ? " · past" : ` · ${left} day${left === 1 ? "" : "s"} left`) : ""}` : undefined },
                  { label: "Value", value: secrets ? inr(c.value) : <span className="inline-flex items-center gap-1 text-muted"><Lock className="size-3.5" aria-hidden /> Restricted</span> },
                  { label: "Signed on", value: c.signedOn ? fmtDate(c.signedOn) : c.status === "draft" ? "Awaiting signature" : undefined },
                  { label: "Renewal reminder", value: `${c.renewalReminderDays} days before the end date` },
                  { label: "Auto-renew", value: c.autoRenew ? "Yes" : "No" },
                  { label: "Created", value: `${fmtDate(c.createdAt)}${c.createdBy ? ` · ${names.get(c.createdBy.toString()) ?? ""}` : ""}` },
                  ...(renewedFrom
                    ? [{ label: "Renews", value: <Link href={`/contracts/${renewedFrom._id}`} className="font-medium text-brand-600 hover:text-brand-800">{renewedFrom.contractNo}</Link> }]
                    : []),
                  ...(renewedTo
                    ? [{ label: "Renewed as", value: <Link href={`/contracts/${renewedTo._id}`} className="font-medium text-brand-600 hover:text-brand-800">{renewedTo.contractNo}</Link> }]
                    : []),
                  ...(secrets && c.notes ? [{ label: "Notes", value: <span className="whitespace-pre-line">{c.notes}</span>, full: true }] : []),
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Signed documents" />
            <CardBody>
              {secrets ? (
                <AttachmentsPanel
                  entityType="contract"
                  entityId={id}
                  canManage={canManage}
                  confidential={c.confidential}
                  add={addContractFiles.bind(null, id)}
                  remove={removeContractFile.bind(null, id)}
                  files={c.attachments.map((a) => ({ refId: a._id?.toString() ?? a.file.toString(), file: a.file.toString(), name: a.name, size: a.size }))}
                />
              ) : (
                <p className="flex items-center gap-2 text-[13px] text-muted">
                  <Lock className="size-4" aria-hidden /> This contract is confidential. Its files are visible to people who manage contracts or hold access to restricted client information.
                </p>
              )}
            </CardBody>
          </Card>
        </div>

        <aside>
          <Card>
            <CardHeader title="History" />
            <CardBody>
              <Timeline items={history} />
            </CardBody>
          </Card>
        </aside>
      </div>
    </PageBody>
  );
}
