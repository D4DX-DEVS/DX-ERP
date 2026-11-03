import Link from "next/link";
import { Lock, Plus } from "lucide-react";
import { and, asc, count, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import { can, requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Client, Contract, Project, Proposal, type ContractStatus } from "@/lib/models";
import { idParam, pageParam, PAGE_SIZE, param, sortParam, type SearchParams, type SortChoices } from "@/lib/query";
import { inList, nocase, searchAny } from "@/lib/sql";
import { inr, inrCompact } from "@/lib/format";
import { STATUS } from "@/lib/status";
import { fmtDate } from "@/lib/time";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusChip, Tag } from "@/components/ui/chip";
import { ClearFilters, FilterBar, Pagination, SearchInput, SelectFilter, SortSelect } from "@/components/ui/filters";
import { PageBody, PageHeader, StatCard } from "@/components/ui/page";
import { EmptyRow, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { canSeeContractSecrets, clientScope, hiddenClientIds, recordScope } from "@/app/(app)/crm/_lib/access";
import { endsWithin, today } from "@/app/(app)/crm/_lib/clock";

export const metadata = { title: "Contracts" };

const SORTS = {
  endDate: { label: "End date (soonest)", order: [asc(Contract.endDate), desc(Contract.createdAt)] },
  endDateDesc: { label: "End date (latest)", order: [desc(Contract.endDate), desc(Contract.createdAt)] },
  newest: { label: "Newest first", order: [desc(Contract.createdAt)] },
  oldest: { label: "Oldest first", order: [asc(Contract.createdAt)] },
  title: { label: "Title A–Z", order: [asc(nocase(Contract.title)), desc(Contract.createdAt)] },
  updated: { label: "Recently updated", order: [desc(Contract.updatedAt)] },
} satisfies SortChoices<SQL[]>;

export default async function ContractsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePagePermission("contracts.view");
  const sp = await searchParams;
  const canManage = can(user, "contracts.manage");
  const page = pageParam(sp);
  const sort = sortParam(sp, SORTS);
  const status = param(sp, "status");
  const type = param(sp, "type");
  const clientId = idParam(sp, "client");
  const expiringOnly = param(sp, "expiring") === "1";
  const q = param(sp, "q");

  const hidden = await hiddenClientIds(user);
  const scope = recordScope(hidden, user, Contract.client, [Contract.createdBy]);

  // "Expiring soon" is per contract (its own reminder window), so resolve the ids first.
  const activeWithEnd = await db()
    .select({ _id: Contract._id, endDate: Contract.endDate, renewalReminderDays: Contract.renewalReminderDays })
    .from(Contract)
    .where(and(scope, eq(Contract.status, "active"), gte(Contract.endDate, today())));
  const expiring = activeWithEnd.filter((c) => endsWithin(c.endDate, c.renewalReminderDays));
  const expiringIds = expiring.map((c) => c._id);

  const conds: (SQL | undefined)[] = [scope];
  if (status && status in STATUS.contract) conds.push(eq(Contract.status, status as ContractStatus));
  if (type) conds.push(eq(Contract.type, type));
  if (clientId) conds.push(eq(Contract.client, clientId));
  if (expiringOnly) conds.push(inList(Contract._id, expiringIds));
  conds.push(searchAny(q, Contract.title, Contract.contractNo));
  const filter = and(...conds);

  const [rows, total, clients, types, counts, upcoming] = await Promise.all([
    db()
      .select({
        _id: Contract._id,
        title: Contract.title,
        contractNo: Contract.contractNo,
        client: Contract.client,
        project: Contract.project,
        proposal: Contract.proposal,
        type: Contract.type,
        startDate: Contract.startDate,
        endDate: Contract.endDate,
        value: Contract.value,
        status: Contract.status,
        confidential: Contract.confidential,
        createdBy: Contract.createdBy,
      })
      .from(Contract)
      .where(filter)
      .orderBy(...sort.order)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db().$count(Contract, filter),
    db().select({ _id: Client._id, name: Client.name }).from(Client).where(clientScope(user)).orderBy(asc(Client.name)).limit(500),
    db().selectDistinct({ type: Contract.type }).from(Contract),
    db()
      .select({ status: Contract.status, n: count(), value: sql<number>`coalesce(sum(${Contract.value}), 0)`.mapWith(Number) })
      .from(Contract)
      .where(scope)
      .groupBy(Contract.status),
    db()
      .select({ _id: Contract._id, title: Contract.title, endDate: Contract.endDate, autoRenew: Contract.autoRenew, client: Contract.client, contractNo: Contract.contractNo })
      .from(Contract)
      .where(and(scope, eq(Contract.status, "active"), gte(Contract.endDate, today())))
      .orderBy(asc(Contract.endDate))
      .limit(5),
  ]);

  const clientIds = [...new Set([...rows.map((r) => r.client), ...upcoming.map((r) => r.client)])];
  const projectIds = rows.flatMap((r) => (r.project ? [r.project] : []));
  const proposalIds = rows.flatMap((r) => (r.proposal ? [r.proposal] : []));
  const [clientDocs, projectDocs, proposalDocs] = await Promise.all([
    db().select({ _id: Client._id, name: Client.name }).from(Client).where(inList(Client._id, clientIds)),
    projectIds.length ? db().select({ _id: Project._id, projectNo: Project.projectNo }).from(Project).where(inList(Project._id, projectIds)) : [],
    proposalIds.length ? db().select({ _id: Proposal._id, proposalNo: Proposal.proposalNo }).from(Proposal).where(inList(Proposal._id, proposalIds)) : [],
  ]);
  const clientName = new Map(clientDocs.map((c) => [c._id, c.name]));
  const projectNo = new Map(projectDocs.map((p) => [p._id, p.projectNo]));
  const proposalNo = new Map(proposalDocs.map((p) => [p._id, p.proposalNo]));
  const expiringSet = new Set(expiringIds);

  const active = counts.find((c) => c.status === "active");
  const awaiting = counts.find((c) => c.status === "draft");
  const filtered = Boolean(q || status || type || clientId || expiringOnly);

  return (
    <PageBody>
      <PageHeader
        overline="Sales"
        title="Contracts"
        actions={
          canManage && (
            <ButtonLink href="/contracts/new" icon={<Plus className="size-4" aria-hidden />}>
              New contract
            </ButtonLink>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Active" value={active?.n ?? 0} />
        <StatCard
          label="Expiring soon"
          value={<span className={expiring.length > 0 ? "text-warning" : undefined}>{expiring.length}</span>}
          sub="inside their renewal window"
          href={expiringOnly ? "/contracts" : "/contracts?expiring=1"}
        />
        <StatCard label="Awaiting signature" value={awaiting?.n ?? 0} />
        {canManage ? <StatCard label="Active value" value={inrCompact(active?.value ?? 0)} sub="management only" /> : <StatCard label="Total contracts" value={counts.reduce((s, c) => s + c.n, 0)} />}
      </div>

      <FilterBar>
        <SearchInput placeholder="Search number or title" />
        <SelectFilter param="status" label="Status" allLabel="All statuses" options={Object.entries(STATUS.contract).map(([value, [label]]) => ({ value, label }))} />
        <SelectFilter param="type" label="Type" allLabel="All types" options={types.map((t) => t.type).filter((t): t is string => Boolean(t)).map((t) => ({ value: t, label: t }))} />
        <SelectFilter param="client" label="Client" allLabel="All clients" options={clients.map((c) => ({ value: c._id, label: c.name }))} />
        <SelectFilter param="expiring" label="Expiry" allLabel="Any expiry" options={[{ value: "1", label: "Expiring soon" }]} />
        <SortSelect options={sort.options} />
        <ClearFilters />
      </FilterBar>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <TableWrap phone={[1, "last"]} tablet={[1, 3, 5, "last"]}>
            <THead>
              <Th>Contract</Th>
              <Th>Type</Th>
              <Th>Linked to</Th>
              <Th>Term</Th>
              <Th align="right">Value</Th>
              <Th>Status</Th>
            </THead>
            <tbody>
              {rows.length === 0 && <EmptyRow colSpan={6}>{filtered ? "No contracts match these filters." : "No contracts yet. Upload a signed contract to start tracking terms and renewals."}</EmptyRow>}
              {rows.map((c) => {
                const secrets = canSeeContractSecrets(user, c);
                const link = [c.project && projectNo.get(c.project), c.proposal && proposalNo.get(c.proposal)].filter(Boolean).join(" · ");
                return (
                  <Tr key={c._id}>
                    <Td>
                      <Link href={`/contracts/${c._id}`} className="flex items-center gap-1.5 font-semibold text-ink hover:text-brand-600">
                        {c.title}
                        {c.confidential && <Lock className="size-3.5 shrink-0 text-muted" role="img" aria-label="Confidential" />}
                      </Link>
                      <div className="text-xs text-muted">
                        {c.contractNo} · {clientName.get(c.client) ?? "—"}
                      </div>
                    </Td>
                    <Td>{c.type ? <Tag tone="gray">{c.type}</Tag> : "—"}</Td>
                    <Td className="text-xs text-ink-2">{link || "—"}</Td>
                    <Td className="text-xs whitespace-nowrap text-ink-2">
                      {c.startDate ? fmtDate(c.startDate, "d MMM yyyy") : "—"}
                      <span className="block">to {c.endDate ? fmtDate(c.endDate, "d MMM yyyy") : "—"}</span>
                    </Td>
                    <Td align="right" className="font-semibold">
                      {secrets ? (c.value ? inr(c.value) : "—") : <span className="text-muted">Restricted</span>}
                    </Td>
                    <Td>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <StatusChip domain="contract" value={c.status} />
                        {expiringSet.has(c._id) && <Tag tone="amber">Expiring</Tag>}
                      </span>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </TableWrap>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
        </Card>

        <Card>
          <CardHeader title="Renewals coming up" />
          <CardBody className="flex flex-col">
            {upcoming.length === 0 && <p className="text-[13px] text-muted">No active contracts with an upcoming end date.</p>}
            {upcoming.map((c) => (
              <Link key={c._id} href={`/contracts/${c._id}`} className="flex items-center gap-3 border-t border-line-soft py-2.5 first:border-t-0 hover:bg-field">
                <span className="w-11 shrink-0 text-center">
                  <span className="block text-[11px] text-muted uppercase">{fmtDate(c.endDate, "MMM")}</span>
                  <span className="block font-display text-lg font-semibold text-ink">{fmtDate(c.endDate, "d")}</span>
                </span>
                <span className="min-w-0 flex-1 text-[13px]">
                  <strong className="block truncate font-semibold text-ink">{c.title}</strong>
                  <span className="text-muted">
                    {clientName.get(c.client) ?? ""}
                    {c.autoRenew ? " · auto-renews" : ""}
                  </span>
                </span>
              </Link>
            ))}
          </CardBody>
        </Card>
      </div>
    </PageBody>
  );
}
