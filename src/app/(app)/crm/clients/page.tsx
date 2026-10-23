import Link from "next/link";
import { Lock, Plus } from "lucide-react";
import { can, requirePagePermission } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Client, Invoice, Project } from "@/lib/models";
import { peopleOptions } from "@/lib/people";
import { idParam, pageParam, PAGE_SIZE, param, searchRegex, type SearchParams } from "@/lib/query";
import { inr } from "@/lib/format";
import { STATUS } from "@/lib/status";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/chip";
import { ClearFilters, FilterBar, Pagination, SearchInput, SelectFilter } from "@/components/ui/filters";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Segmented } from "@/components/ui/tabs";
import { EmptyRow, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { clientScope } from "../_lib/access";
import { userCards } from "../_lib/queries";

export const metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePagePermission("crm.view");
  const sp = await searchParams;
  await connectDB();
  const page = pageParam(sp);
  const status = param(sp, "status");
  const owner = idParam(sp, "owner");
  const q = param(sp, "q");
  const showMoney = can(user, "invoices.view");

  const and: Record<string, unknown>[] = [clientScope(user)];
  if (status && status in STATUS.client) and.push({ status });
  if (owner) and.push({ owner });
  const re = searchRegex(q);
  if (re) and.push({ $or: [{ name: re }, { clientNo: re }, { contactPerson: re }, { email: re }, { phone: re }] });
  const filter = { $and: and };

  const [rows, total, people] = await Promise.all([
    Client.find(filter).sort({ name: 1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    Client.countDocuments(filter),
    peopleOptions(),
  ]);
  const ids = rows.map((r) => r._id);
  const [projectCounts, balances, owners] = await Promise.all([
    ids.length ? Project.aggregate<{ _id: unknown; n: number }>([{ $match: { client: { $in: ids } } }, { $group: { _id: "$client", n: { $sum: 1 } } }]) : [],
    showMoney && ids.length
      ? Invoice.aggregate<{ _id: unknown; balance: number }>([
          { $match: { client: { $in: ids }, status: { $in: ["issued", "partially_paid", "overdue"] } } },
          { $group: { _id: "$client", balance: { $sum: "$balance" } } },
        ])
      : [],
    userCards(rows.map((r) => r.owner)),
  ]);
  const projectsBy = new Map(projectCounts.map((p) => [String(p._id), p.n]));
  const balanceBy = new Map(balances.map((b) => [String(b._id), b.balance]));
  const colCount = showMoney ? 8 : 7;

  return (
    <PageBody>
      <PageHeader
        overline="Sales"
        title="Clients"
        actions={
          <>
            <Segmented
              items={[
                { href: "/crm", label: "Pipeline" },
                { href: "/crm/clients", label: "Clients", active: true },
              ]}
            />
            {can(user, "crm.manage") && (
              <ButtonLink href="/crm/clients/new" icon={<Plus className="size-4" aria-hidden />}>
                New client
              </ButtonLink>
            )}
          </>
        }
      />
      <FilterBar>
        <SearchInput placeholder="Search name, number, contact, email, phone" />
        <SelectFilter param="status" label="Status" allLabel="All statuses" options={Object.entries(STATUS.client).map(([value, [label]]) => ({ value, label }))} />
        <SelectFilter param="owner" label="Owner" allLabel="All owners" options={people.map((p) => ({ value: p.id, label: p.name }))} />
        <ClearFilters />
      </FilterBar>
      <Card>
        <TableWrap phone={[1, 4]} tablet={[1, 2, 4, 7]}>
          <THead>
            <Th>Client</Th>
            <Th>Contact</Th>
            <Th>Email / phone</Th>
            <Th>Status</Th>
            <Th>Owner</Th>
            <Th align="right">Projects</Th>
            {showMoney && <Th align="right">Outstanding</Th>}
            <Th>
              <span className="sr-only">Open</span>
            </Th>
          </THead>
          <tbody>
            {rows.length === 0 && (
              <EmptyRow colSpan={colCount}>
                {q || status || owner ? "No clients match these filters." : "No clients yet. Clients are created when a lead is won, or you can add one directly."}
              </EmptyRow>
            )}
            {rows.map((c) => {
              const id = c._id.toString();
              const o = c.owner ? owners.get(c.owner.toString()) : undefined;
              const due = balanceBy.get(id) ?? 0;
              return (
                <Tr key={id}>
                  <Td>
                    <Link href={`/crm/clients/${id}`} className="flex items-center gap-1.5 font-semibold text-ink hover:text-brand-600">
                      {c.name}
                      {c.confidential && <Lock className="size-3.5 text-muted" aria-label="Restricted client" role="img" />}
                    </Link>
                    <div className="text-xs text-muted">
                      {c.clientNo} · {c.type === "individual" ? "Individual" : "Company"}
                    </div>
                  </Td>
                  <Td>
                    {c.contactPerson ?? "—"}
                    {c.contactDesignation && <div className="text-xs text-muted">{c.contactDesignation}</div>}
                  </Td>
                  <Td>
                    <div className="max-w-56 truncate">{c.email ?? "—"}</div>
                    <div className="text-xs text-muted">{c.phone ?? ""}</div>
                  </Td>
                  <Td>
                    <StatusChip domain="client" value={c.status} />
                  </Td>
                  <Td>{o?.name ?? <span className="text-muted">Unassigned</span>}</Td>
                  <Td align="right">{projectsBy.get(id) ?? 0}</Td>
                  {showMoney && (
                    <Td align="right" className={due > 0 ? "font-semibold text-danger" : "text-muted"}>
                      {due > 0 ? inr(due) : "—"}
                    </Td>
                  )}
                  <Td align="right">
                    <Link href={`/crm/clients/${id}`} className="text-[13px] font-semibold text-brand-600 hover:text-brand-800">
                      Open
                    </Link>
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
