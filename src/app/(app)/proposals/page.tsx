import Link from "next/link";
import { Plus } from "lucide-react";
import { can, requirePagePermission } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Client, Proposal } from "@/lib/models";
import { idParam, pageParam, PAGE_SIZE, param, searchRegex, type SearchParams } from "@/lib/query";
import { inr, inrCompact, plural } from "@/lib/format";
import { STATUS } from "@/lib/status";
import { fmtDate } from "@/lib/time";
import { cn } from "@/lib/cn";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusChip, Tag } from "@/components/ui/chip";
import { ClearFilters, FilterBar, Pagination, SearchInput, SelectFilter } from "@/components/ui/filters";
import { PageBody, PageHeader, StatCard } from "@/components/ui/page";
import { EmptyRow, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { clientScope, hiddenClientIds, recordScope } from "@/app/(app)/crm/_lib/access";
import { daysUntil, inDays, today } from "@/app/(app)/crm/_lib/clock";

export const metadata = { title: "Proposals" };

export default async function ProposalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePagePermission("proposals.view");
  const sp = await searchParams;
  await connectDB();
  const page = pageParam(sp);
  const status = param(sp, "status");
  const kind = param(sp, "kind");
  const clientId = idParam(sp, "client");
  const q = param(sp, "q");

  const hidden = await hiddenClientIds(user);
  const scope = recordScope(hidden, user, ["owner", "createdBy"]);
  const and: Record<string, unknown>[] = [scope];
  if (status && status in STATUS.proposal) and.push({ status });
  if (kind === "proposal" || kind === "quotation") and.push({ kind });
  if (clientId) and.push({ client: clientId });
  const re = searchRegex(q);
  if (re) and.push({ $or: [{ title: re }, { proposalNo: re }] });
  const filter = { $and: and };

  const [rows, total, clients, byStatus, expiring] = await Promise.all([
    Proposal.find(filter).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    Proposal.countDocuments(filter),
    Client.find(clientScope(user), { name: 1 }).sort({ name: 1 }).limit(500).lean(),
    Proposal.aggregate<{ _id: string; n: number; value: number }>([{ $match: { $and: [scope] } }, { $group: { _id: "$status", n: { $sum: 1 }, value: { $sum: "$total" } } }]),
    Proposal.countDocuments({ $and: [scope, { status: { $in: ["sent", "negotiation"] }, validUntil: { $gte: today(), $lte: inDays(7) } }] }),
  ]);
  const clientNames = new Map(clients.map((c) => [c._id.toString(), c.name]));
  const missing = rows.map((r) => r.client.toString()).filter((c) => !clientNames.has(c));
  if (missing.length) {
    const extra = await Client.find({ _id: { $in: missing } }, { name: 1 }).lean();
    for (const c of extra) clientNames.set(c._id.toString(), c.name);
  }

  const stat = (keys: string[]) => {
    const rowsFor = byStatus.filter((b) => keys.includes(b._id));
    return { n: rowsFor.reduce((s, b) => s + b.n, 0), value: rowsFor.reduce((s, b) => s + b.value, 0) };
  };
  const drafts = stat(["draft"]);
  const awaiting = stat(["sent", "negotiation"]);
  const approved = stat(["approved"]);
  const filtered = Boolean(q || status || kind || clientId);

  return (
    <PageBody>
      <PageHeader
        overline="Sales"
        title="Proposals & quotations"
        actions={
          can(user, "proposals.manage") && (
            <ButtonLink href="/proposals/new" icon={<Plus className="size-4" aria-hidden />}>
              New proposal
            </ButtonLink>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Drafts" value={drafts.n} sub={inrCompact(drafts.value)} />
        <StatCard label="Awaiting decision" value={awaiting.n} sub={`${inrCompact(awaiting.value)} sent or in negotiation`} />
        <StatCard label="Approved, not converted" value={approved.n} sub={approved.n ? `${inrCompact(approved.value)} ready for a project` : "nothing waiting"} />
        <StatCard label="Expiring in 7 days" value={expiring} tone={expiring > 0 ? "alert" : "default"} sub={expiring > 0 ? "follow up before they lapse" : "none expiring soon"} />
      </div>

      <FilterBar>
        <SearchInput placeholder="Search number or title" />
        <SelectFilter param="status" label="Status" allLabel="All statuses" options={Object.entries(STATUS.proposal).map(([value, [label]]) => ({ value, label }))} />
        <SelectFilter
          param="kind"
          label="Type"
          allLabel="Proposals & quotations"
          options={[
            { value: "proposal", label: "Proposals" },
            { value: "quotation", label: "Quotations" },
          ]}
        />
        <SelectFilter param="client" label="Client" allLabel="All clients" options={clients.map((c) => ({ value: c._id.toString(), label: c.name }))} />
        <ClearFilters />
      </FilterBar>

      <Card>
        <TableWrap phone={[1, 4, 6]} tablet={[1, 3, 4, 6]}>
          <THead>
            <Th>Proposal</Th>
            <Th>Type</Th>
            <Th>Client</Th>
            <Th align="right">Total</Th>
            <Th>Valid until</Th>
            <Th>Status</Th>
          </THead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={6}>{filtered ? "No proposals match these filters." : "No proposals yet. Create one from a lead or a client."}</EmptyRow>}
            {rows.map((p) => {
              const left = daysUntil(p.validUntil);
              const open = p.status === "sent" || p.status === "negotiation";
              return (
                <Tr key={p._id.toString()}>
                  <Td>
                    <Link href={`/proposals/${p._id}`} className="font-semibold text-ink hover:text-brand-600">
                      {p.title}
                    </Link>
                    <div className="text-xs text-muted">
                      {p.proposalNo} · v{p.version}
                    </div>
                  </Td>
                  <Td>
                    <Tag tone={p.kind === "quotation" ? "purple" : "blue"} className="capitalize">
                      {p.kind}
                    </Tag>
                  </Td>
                  <Td>{clientNames.get(p.client.toString()) ?? "—"}</Td>
                  <Td align="right" className="font-semibold">
                    {inr(p.total)}
                  </Td>
                  <Td className={cn("whitespace-nowrap", open && left !== null && left <= 3 && "font-semibold text-warning")}>
                    {p.validUntil ? fmtDate(p.validUntil) : "—"}
                    {open && left !== null && left >= 0 && left <= 7 && <span className="block text-xs">{left === 0 ? "expires today" : `${plural(left, "day")} left`}</span>}
                  </Td>
                  <Td>
                    <StatusChip domain="proposal" value={p.status} />
                  </Td>
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
