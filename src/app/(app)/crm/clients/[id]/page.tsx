import Link from "next/link";
import { FileSignature, FileText, FolderKanban, Info, Lock, MessagesSquare, Paperclip, Pencil, Plus, Receipt, Target } from "lucide-react";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { can, requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Activity, Contract, Invoice, Lead, Project, Proposal } from "@/lib/models";
import { namesFor, peopleOptions } from "@/lib/people";
import { param, type SearchParams } from "@/lib/query";
import { inList } from "@/lib/sql";
import { getSettings } from "@/lib/settings";
import { inr } from "@/lib/format";
import { fmtDate } from "@/lib/time";
import { projectFilter } from "@/lib/work-access";
import { cn } from "@/lib/cn";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { OptionChip, StatusChip, Tag } from "@/components/ui/chip";
import { PageBody } from "@/components/ui/page";
import { EmptyRow, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { LinkTabs } from "@/components/ui/tabs";
import { addAttachments, removeAttachment } from "../../actions";
import { canSeeContractSecrets, pageClient } from "../../_lib/access";
import { ageLabel } from "../../_lib/clock";
import { userCards } from "../../_lib/queries";
import { ActivityComposer } from "../../_components/activity-composer";
import { ActivityFeed, type FeedItem } from "../../_components/activity-feed";
import { AttachmentsPanel } from "../../_components/attachments-panel";
import { ContactsCard } from "../../_components/contacts-card";
import { DeleteRecord } from "../../_components/delete-record";

export const metadata = { title: "Client" };

const TABS = ["activity", "leads", "proposals", "contracts", "projects", "invoices", "files", "details"] as const;
type Tab = (typeof TABS)[number];

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requirePagePermission("crm.view");
  const client = await pageClient(user, id);
  const settings = await getSettings();

  const canManage = can(user, "crm.manage");
  const canProposals = can(user, "proposals.view");
  const canContracts = can(user, "contracts.view");
  const canInvoices = can(user, "invoices.view");

  const available = TABS.filter((t) => (t === "proposals" ? canProposals : t === "contracts" ? canContracts : t === "invoices" ? canInvoices : true));
  const requested = param(sp, "tab") as Tab;
  const tab: Tab = available.includes(requested) ? requested : "activity";

  const [leadCount, proposalCount, contractCount, projectCount, invoiceCount, openLeads, owner] = await Promise.all([
    db().$count(Lead, eq(Lead.client, client._id)),
    canProposals ? db().$count(Proposal, eq(Proposal.client, client._id)) : 0,
    canContracts ? db().$count(Contract, eq(Contract.client, client._id)) : 0,
    db().$count(Project, and(eq(Project.client, client._id), projectFilter(user))),
    canInvoices ? db().$count(Invoice, and(eq(Invoice.client, client._id), ne(Invoice.status, "draft"))) : 0,
    db().select({ expectedValue: Lead.expectedValue }).from(Lead).where(and(eq(Lead.client, client._id), eq(Lead.status, "open"))),
    client.owner ? userCards([client.owner]) : new Map(),
  ]);
  const ownerName = client.owner ? owner.get(client.owner)?.name : undefined;
  const openDealValue = openLeads.reduce((s, l) => s + (l.expectedValue ?? 0), 0);

  let money: { billed: number; outstanding: number } | null = null;
  if (canInvoices) {
    const rows = await db()
      .select({
        status: Invoice.status,
        total: sql<number>`coalesce(sum(${Invoice.total}), 0)`.mapWith(Number),
        balance: sql<number>`coalesce(sum(${Invoice.balance}), 0)`.mapWith(Number),
      })
      .from(Invoice)
      .where(and(eq(Invoice.client, client._id), inList(Invoice.status, ["issued", "partially_paid", "paid", "overdue"])))
      .groupBy(Invoice.status);
    money = {
      billed: rows.reduce((s, r) => s + r.total, 0),
      outstanding: rows.filter((r) => r.status !== "paid").reduce((s, r) => s + r.balance, 0),
    };
  }

  const href = (t: Tab) => (t === "activity" ? `/crm/clients/${id}` : `/crm/clients/${id}?tab=${t}`);
  const tabIcon = "size-[18px]";
  const tabLabels: Record<Tab, { label: string; icon: React.ReactNode; count?: number }> = {
    activity: { label: "Activity", icon: <MessagesSquare className={tabIcon} /> },
    leads: { label: "Leads", icon: <Target className={tabIcon} />, count: leadCount },
    proposals: { label: "Proposals", icon: <FileText className={tabIcon} />, count: proposalCount },
    contracts: { label: "Contracts", icon: <FileSignature className={tabIcon} />, count: contractCount },
    projects: { label: "Projects", icon: <FolderKanban className={tabIcon} />, count: projectCount },
    invoices: { label: "Invoices", icon: <Receipt className={tabIcon} />, count: invoiceCount },
    files: { label: "Files", icon: <Paperclip className={tabIcon} />, count: client.attachments.length },
    details: { label: "Details", icon: <Info className={tabIcon} /> },
  };

  /* -------------------------------------------------------------- tab content */
  let content: React.ReactNode = null;

  if (tab === "activity") {
    const [activities, people] = await Promise.all([
      db()
        .select({
          _id: Activity._id,
          type: Activity.type,
          subject: Activity.subject,
          notes: Activity.notes,
          at: Activity.at,
          dueAt: Activity.dueAt,
          done: Activity.done,
          doneAt: Activity.doneAt,
          outcome: Activity.outcome,
          byName: Activity.byName,
          by: Activity.by,
          assignedTo: Activity.assignedTo,
          lead: Activity.lead,
        })
        .from(Activity)
        .where(eq(Activity.client, client._id))
        .orderBy(desc(Activity.at))
        .limit(300),
      canManage ? peopleOptions() : [],
    ]);
    const leadIds = [...new Set(activities.map((a) => a.lead).filter((l): l is string => Boolean(l)))];
    const [leads, names] = await Promise.all([
      leadIds.length ? db().select({ _id: Lead._id, leadNo: Lead.leadNo }).from(Lead).where(inList(Lead._id, leadIds)) : [],
      namesFor(activities.map((a) => a.assignedTo)),
    ]);
    const leadNo = new Map(leads.map((l) => [l._id, l.leadNo]));
    const feed: FeedItem[] = activities.map((a) => ({
      id: a._id,
      type: a.type,
      subject: a.subject,
      notes: a.notes ?? undefined,
      at: a.at,
      dueAt: a.dueAt ?? undefined,
      done: a.done,
      doneAt: a.doneAt ?? undefined,
      outcome: a.outcome ?? undefined,
      byName: a.byName ?? undefined,
      assigneeName: a.assignedTo ? names.get(a.assignedTo) : undefined,
      lead: a.lead && leadNo.get(a.lead) ? { id: a.lead, leadNo: leadNo.get(a.lead) as string } : undefined,
      canComplete: canManage || [a.assignedTo, a.by].some((p) => p === user.id),
    }));
    content = (
      <Card>
        <CardHeader title="Communication history" subtitle="Calls, meetings, emails, WhatsApp, notes and follow-ups — including those logged on leads" />
        {canManage && (
          <div id="composer" className="border-b border-line-soft px-5 pb-4">
            <ActivityComposer client={id} people={people} currentUserId={user.id} />
          </div>
        )}
        <ActivityFeed items={feed} showLead />
      </Card>
    );
  } else if (tab === "leads") {
    const leads = await db()
      .select({ _id: Lead._id, title: Lead.title, leadNo: Lead.leadNo, stage: Lead.stage, expectedValue: Lead.expectedValue, createdAt: Lead.createdAt })
      .from(Lead)
      .where(eq(Lead.client, client._id))
      .orderBy(desc(Lead.createdAt))
      .limit(100);
    content = (
      <Card>
        <TableWrap tablet={[1, 2, 3, 4]}>
          <THead>
            <Th>Lead</Th>
            <Th>Stage</Th>
            <Th align="right">Expected value</Th>
            <Th align="right">Age</Th>
          </THead>
          <tbody>
            {leads.length === 0 && <EmptyRow colSpan={4}>No leads for this client yet.</EmptyRow>}
            {leads.map((l) => (
              <Tr key={l._id} href={`/crm/leads/${l._id}`}>
                <Td>
                  <Link href={`/crm/leads/${l._id}`} className="font-semibold text-ink hover:text-brand-600">
                    {l.title}
                  </Link>
                  <div className="text-xs text-muted">{l.leadNo}</div>
                </Td>
                <Td>
                  <OptionChip options={settings.pipelineStages} value={l.stage} />
                </Td>
                <Td align="right">{l.expectedValue ? inr(l.expectedValue) : "—"}</Td>
                <Td align="right" className="text-muted">
                  {ageLabel(l.createdAt)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    );
  } else if (tab === "proposals") {
    const rows = await db()
      .select({ _id: Proposal._id, title: Proposal.title, proposalNo: Proposal.proposalNo, version: Proposal.version, total: Proposal.total, validUntil: Proposal.validUntil, status: Proposal.status })
      .from(Proposal)
      .where(eq(Proposal.client, client._id))
      .orderBy(desc(Proposal.createdAt))
      .limit(100);
    content = (
      <Card>
        <TableWrap tablet={[1, 2, 3, 4]}>
          <THead>
            <Th>Proposal</Th>
            <Th align="right">Total</Th>
            <Th>Valid until</Th>
            <Th>Status</Th>
          </THead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={4}>No proposals for this client yet.</EmptyRow>}
            {rows.map((p) => (
              <Tr key={p._id} href={`/proposals/${p._id}`}>
                <Td>
                  <Link href={`/proposals/${p._id}`} className="font-semibold text-ink hover:text-brand-600">
                    {p.title}
                  </Link>
                  <div className="text-xs text-muted">
                    {p.proposalNo} · v{p.version}
                  </div>
                </Td>
                <Td align="right">{inr(p.total)}</Td>
                <Td>{p.validUntil ? fmtDate(p.validUntil) : "—"}</Td>
                <Td>
                  <StatusChip domain="proposal" value={p.status} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    );
  } else if (tab === "contracts") {
    const rows = await db()
      .select({
        _id: Contract._id,
        title: Contract.title,
        contractNo: Contract.contractNo,
        type: Contract.type,
        startDate: Contract.startDate,
        endDate: Contract.endDate,
        value: Contract.value,
        status: Contract.status,
        confidential: Contract.confidential,
        createdBy: Contract.createdBy,
      })
      .from(Contract)
      .where(eq(Contract.client, client._id))
      .orderBy(desc(Contract.createdAt))
      .limit(100);
    content = (
      <Card>
        <TableWrap tablet={[1, 2, 3, 4]}>
          <THead>
            <Th>Contract</Th>
            <Th>Term</Th>
            <Th align="right">Value</Th>
            <Th>Status</Th>
          </THead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={4}>No contracts for this client yet.</EmptyRow>}
            {rows.map((c) => {
              const secrets = canSeeContractSecrets(user, c);
              return (
                <Tr key={c._id} href={`/contracts/${c._id}`}>
                  <Td>
                    <Link href={`/contracts/${c._id}`} className="flex items-center gap-1.5 font-semibold text-ink hover:text-brand-600">
                      {c.title}
                      {c.confidential && <Lock className="size-3.5 text-muted" role="img" aria-label="Confidential" />}
                    </Link>
                    <div className="text-xs text-muted">
                      {c.contractNo}
                      {c.type ? ` · ${c.type}` : ""}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap text-ink-2">
                    {c.startDate ? fmtDate(c.startDate) : "—"} – {c.endDate ? fmtDate(c.endDate) : "—"}
                  </Td>
                  <Td align="right">{secrets ? inr(c.value) : "—"}</Td>
                  <Td>
                    <StatusChip domain="contract" value={c.status} />
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>
    );
  } else if (tab === "projects") {
    const rows = await db()
      .select({ _id: Project._id, projectNo: Project.projectNo, title: Project.title, status: Project.status, targetDate: Project.targetDate, budget: Project.budget })
      .from(Project)
      .where(and(eq(Project.client, client._id), projectFilter(user)))
      .orderBy(desc(Project.createdAt))
      .limit(100);
    const showBudget = can(user, "projects.financials");
    content = (
      <Card>
        <TableWrap tablet={[1, 2, 3, 4]}>
          <THead>
            <Th>Project</Th>
            <Th>Status</Th>
            <Th>Target date</Th>
            {showBudget && <Th align="right">Budget</Th>}
          </THead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={showBudget ? 4 : 3}>No projects for this client yet.</EmptyRow>}
            {rows.map((p) => (
              <Tr key={p._id} href={`/projects/${p._id}`}>
                <Td>
                  <Link href={`/projects/${p._id}`} className="font-semibold text-ink hover:text-brand-600">
                    {p.title}
                  </Link>
                  <div className="text-xs text-muted">{p.projectNo}</div>
                </Td>
                <Td>
                  <OptionChip options={settings.projectStatuses} value={p.status} />
                </Td>
                <Td>{p.targetDate ? fmtDate(p.targetDate) : "—"}</Td>
                {showBudget && <Td align="right">{inr(p.budget)}</Td>}
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    );
  } else if (tab === "invoices") {
    const rows = await db()
      .select({
        _id: Invoice._id,
        invoiceNo: Invoice.invoiceNo,
        draftNo: Invoice.draftNo,
        issueDate: Invoice.issueDate,
        dueDate: Invoice.dueDate,
        total: Invoice.total,
        balance: Invoice.balance,
        status: Invoice.status,
      })
      .from(Invoice)
      .where(and(eq(Invoice.client, client._id), ne(Invoice.status, "draft")))
      .orderBy(desc(Invoice.issueDate))
      .limit(50);
    content = (
      <Card>
        {money && (
          <div className="grid grid-cols-2 gap-3 border-b border-line-soft px-5 py-4">
            <div>
              <div className="text-xs text-muted">Lifetime billed</div>
              <div className="font-display text-lg font-semibold text-ink tabular">{inr(money.billed)}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Outstanding</div>
              <div className={cn("font-display text-lg font-semibold tabular", money.outstanding > 0 ? "text-danger" : "text-ink")}>{inr(money.outstanding)}</div>
            </div>
          </div>
        )}
        <TableWrap phone={[1, 5, 6]} tablet={[1, 3, 5, 6]}>
          <THead>
            <Th>Invoice</Th>
            <Th>Issued</Th>
            <Th>Due</Th>
            <Th align="right">Total</Th>
            <Th align="right">Balance</Th>
            <Th>Status</Th>
          </THead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={6}>No invoices issued to this client yet.</EmptyRow>}
            {rows.map((i) => (
              <Tr key={i._id} href={`/invoices/${i._id}`}>
                <Td>
                  <Link href={`/invoices/${i._id}`} className="font-semibold text-ink hover:text-brand-600">
                    {i.invoiceNo ?? i.draftNo}
                  </Link>
                </Td>
                <Td>{fmtDate(i.issueDate)}</Td>
                <Td>{fmtDate(i.dueDate)}</Td>
                <Td align="right">{inr(i.total)}</Td>
                <Td align="right">{inr(i.balance)}</Td>
                <Td>
                  <StatusChip domain="invoice" value={i.status} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    );
  } else if (tab === "files") {
    content = (
      <Card>
        <CardHeader title="Files" subtitle="Briefs, NDAs and supporting documents" />
        <CardBody>
          <AttachmentsPanel
            entityType="client"
            entityId={id}
            add={addAttachments.bind(null, "client", id)}
            remove={removeAttachment.bind(null, "client", id)}
            canManage={canManage}
            confidential={client.confidential}
            files={client.attachments.map((a) => ({ refId: a._id ?? a.file, file: a.file, name: a.name, size: a.size }))}
          />
        </CardBody>
      </Card>
    );
  } else {
    const a = client.address;
    const address = [a?.line1, a?.line2, [a?.city, a?.state, a?.postalCode].filter(Boolean).join(", "), a?.country].filter(Boolean).join("\n");
    content = (
      <Card>
        <CardHeader title="Profile" />
        <CardBody>
          <DetailList
            items={[
              { label: "Type", value: client.type === "individual" ? "Individual" : "Company" },
              { label: "Contact person", value: client.contactPerson ? `${client.contactPerson}${client.contactDesignation ? ` · ${client.contactDesignation}` : ""}` : undefined },
              { label: "Email", value: client.email ? <a href={`mailto:${client.email}`} className="text-brand-600 hover:text-brand-800">{client.email}</a> : undefined },
              { label: "Phone", value: client.phone },
              { label: "Alternate phone", value: client.altPhone },
              { label: "Website", value: client.website ? <a href={client.website} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:text-brand-800">{client.website}</a> : undefined },
              { label: "Industry", value: client.industry },
              { label: "GSTIN", value: client.gstin },
              { label: "Lead source", value: client.leadSource },
              { label: "Owner", value: ownerName },
              { label: "Address", value: address ? <span className="whitespace-pre-line">{address}</span> : undefined, full: true },
              { label: "Notes", value: client.notes ? <span className="whitespace-pre-line">{client.notes}</span> : undefined, full: true },
            ]}
          />
        </CardBody>
      </Card>
    );
  }

  const place = client.address?.city;
  return (
    <PageBody>
      <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
        <Link href="/crm/clients" className="font-medium hover:text-brand-600">
          Clients
        </Link>{" "}
        / {client.clientNo}
      </nav>

      <Card className="flex flex-wrap items-center gap-5 p-5 sm:p-6">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-navy font-display text-[22px] font-semibold text-white" aria-hidden>
          {client.name
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w[0])
            .join("")
            .toUpperCase()}
        </span>
        <div className="flex min-w-0 flex-1 basis-80 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-[22px] font-semibold text-ink sm:text-2xl">{client.name}</h1>
            <StatusChip domain="client" value={client.status} />
            {client.confidential && (
              <Tag tone="gray" className="gap-1">
                <Lock className="size-3" aria-hidden /> Restricted
              </Tag>
            )}
            {openLeads.length > 0 && <Tag tone="amber">{openLeads.length} open {openLeads.length === 1 ? "deal" : "deals"}</Tag>}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
            <span>{client.clientNo}</span>
            {(client.industry || place) && <span>{[client.industry, place].filter(Boolean).join(" · ")}</span>}
            {ownerName && (
              <span className="flex items-center gap-1.5">
                Owner <strong className="font-semibold text-ink">{ownerName}</strong>
              </span>
            )}
            {client.leadSource && <span>Source · {client.leadSource}</span>}
            <span>Client since {fmtDate(client.createdAt, "MMM yyyy")}</span>
          </div>
        </div>
        {/* One row on phones: secondary actions show only their icon there. */}
        <div className="flex flex-wrap gap-2">
          {canManage && (
            <ButtonLink href={`/crm/clients/${id}/edit`} variant="secondary" icon={<Pencil className="size-4" aria-hidden />} className="max-sm:w-9 max-sm:px-0">
              <span className="max-sm:sr-only">Edit</span>
            </ButtonLink>
          )}
          {canManage && (
            <ButtonLink href={`/crm/leads/new?client=${id}`} variant="secondary" icon={<Plus className="size-4" aria-hidden />} className="max-sm:w-9 max-sm:px-0">
              <span className="max-sm:sr-only">New lead</span>
            </ButtonLink>
          )}
          {can(user, "proposals.manage") && (
            <ButtonLink href={`/proposals/new?client=${id}`} icon={<Plus className="size-4" aria-hidden />}>
              New proposal
            </ButtonLink>
          )}
          {can(user, "crm.delete") && <DeleteRecord kind="client" id={id} name={`${client.name} (${client.clientNo})`} redirectTo="/crm/clients" />}
        </div>
      </Card>

      <LinkTabs items={available.map((t) => ({ href: href(t), label: tabLabels[t].label, icon: tabLabels[t].icon, count: tabLabels[t].count || undefined, active: t === tab }))} />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">{content}</div>
        <aside className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title="Contacts" />
            <CardBody>
              <ContactsCard
                clientId={id}
                canManage={canManage}
                primary={client.contactPerson ? { name: client.contactPerson, designation: client.contactDesignation ?? undefined, email: client.email ?? undefined, phone: client.phone ?? undefined } : undefined}
                contacts={client.contacts.map((c) => ({ id: c._id ?? c.name, name: c.name, designation: c.designation, email: c.email, phone: c.phone }))}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Commercials" action={<Tag tone="gray" className="bg-navy text-white">RESTRICTED</Tag>} />
            <CardBody className="flex flex-col gap-2.5 text-[13px]">
              {money && (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted">Lifetime billed</span>
                    <strong className="tabular">{inr(money.billed)}</strong>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted">Outstanding</span>
                    <strong className={cn("tabular", money.outstanding > 0 && "text-danger")}>{inr(money.outstanding)}</strong>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">Open deals</span>
                <strong className="tabular">{inr(openDealValue)}</strong>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">GSTIN</span>
                <span>{client.gstin ?? "—"}</span>
              </div>
            </CardBody>
          </Card>
        </aside>
      </div>
    </PageBody>
  );
}
