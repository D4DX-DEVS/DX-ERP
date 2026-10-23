import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { ClearFilters, DateFilter, FilterBar, Pagination, SearchInput, SelectFilter } from "@/components/ui/filters";
import { Menu } from "@/components/ui/menu";
import { PageBody, PageHeader } from "@/components/ui/page";
import { EmptyRow, TableWrap, THead, Td, Th, Tr } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { titleCase } from "@/lib/format";
import { AuditLog } from "@/lib/models";
import { peopleOptions } from "@/lib/people";
import { pageParam, PAGE_SIZE, withParams, type SearchParams } from "@/lib/query";
import { ROLE_LABELS } from "@/lib/rbac/permissions";
import { fmtDateTime } from "@/lib/time";
import { buildAuditFilter } from "./filters";
import { actionLabel, actionTone, AUDIT_ACTIONS } from "./meta";
import { PersonFilter } from "./person-filter";

export const metadata = { title: "Audit trail" };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePagePermission("audit.view");
  const sp = await searchParams;
  await connectDB();
  const page = pageParam(sp);
  const filter = buildAuditFilter(sp);

  const [rows, total, entities, people] = await Promise.all([
    AuditLog.find(filter)
      .sort({ at: -1, _id: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
    AuditLog.countDocuments(filter),
    AuditLog.distinct("entity") as Promise<string[]>,
    peopleOptions({ includeExited: true, personTypes: ["employee", "trainee", "intern", "admin"] }),
  ]);

  const exportHref = (format: string) => withParams("/audit/export", { ...sp, format, page: undefined }, {});
  const filtered = Object.keys(filter).length > 0;

  return (
    <PageBody>
      <PageHeader
        overline="Admin · read-only"
        title="Audit trail"
        description="Who did what, and when. Entries can't be edited or deleted."
        actions={
          <Menu
            trigger={
              <Button variant="secondary" icon={<Download className="size-4" />}>
                Export
              </Button>
            }
            label="Export audit trail"
            items={[
              { label: "CSV (.csv)", href: exportHref("csv"), external: true },
              { label: "Excel (.xlsx)", href: exportHref("xlsx"), external: true },
              { label: "PDF (.pdf)", href: exportHref("pdf"), external: true },
            ]}
          />
        }
      />

      <FilterBar>
        <SearchInput placeholder="Search summary or record ID" className="sm:w-64" />
        <DateFilter param="from" label="From" />
        <DateFilter param="to" label="To" />
        <PersonFilter param="actor" options={people} placeholder="Any user" />
        <SelectFilter param="action" allLabel="All actions" options={AUDIT_ACTIONS.map((a) => ({ value: a, label: actionLabel(a) }))} />
        <SelectFilter param="entity" allLabel="All records" options={[...entities].sort().map((e) => ({ value: e, label: titleCase(e) }))} />
        <ClearFilters />
      </FilterBar>

      <Card>
        <TableWrap phone={[1, 5]} tablet={[1, 2, 3, 5]}>
          <THead>
            <Th>When</Th>
            <Th>User</Th>
            <Th>Action</Th>
            <Th>Record</Th>
            <Th>Summary</Th>
          </THead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={5}>{filtered ? "No audit entries match these filters." : "Nothing has been recorded yet."}</EmptyRow>}
            {rows.map((r) => {
              const changes = r.changes ?? [];
              return (
                <Tr key={r._id.toString()} className="align-top">
                  <Td className="whitespace-nowrap text-xs text-ink-2">{fmtDateTime(r.at)}</Td>
                  <Td>
                    <div className="font-semibold whitespace-nowrap">{r.actorName}</div>
                    <div className="text-xs text-muted">{r.actorRole ? (ROLE_LABELS[r.actorRole] ?? titleCase(r.actorRole)) : "System"}</div>
                  </Td>
                  <Td>
                    <Chip tone={actionTone(r.action)}>{actionLabel(r.action)}</Chip>
                  </Td>
                  <Td>
                    <div className="font-mono text-xs break-all">{r.ref ?? r.entityId?.slice(-8) ?? "—"}</div>
                    <div className="text-xs text-muted">{titleCase(r.entity)}</div>
                  </Td>
                  <Td className="max-w-[30rem] min-w-64">
                    <div className="break-words text-ink-2">{r.summary}</div>
                    {(changes.length > 0 || r.ip) && (
                      <details className="group mt-1.5">
                        <summary className="cursor-pointer text-xs font-semibold text-brand-600 select-none hover:text-brand-800">
                          {changes.length > 0 ? `${changes.length} field change${changes.length === 1 ? "" : "s"}` : "Details"}
                        </summary>
                        {changes.length > 0 && (
                          <div className="mt-2 overflow-hidden rounded-[10px] border border-line text-xs">
                            <div className="grid grid-cols-[minmax(5rem,0.8fr)_1fr_1fr] bg-field font-semibold text-muted">
                              <span className="px-2.5 py-1.5">Field</span>
                              <span className="px-2.5 py-1.5">Before</span>
                              <span className="px-2.5 py-1.5">After</span>
                            </div>
                            {changes.map((c, i) => (
                              <div key={i} className="grid grid-cols-[minmax(5rem,0.8fr)_1fr_1fr] border-t border-line-soft">
                                <span className="px-2.5 py-1.5 break-words text-muted">{c.field}</span>
                                <span className="px-2.5 py-1.5 break-words text-danger line-through decoration-danger/40">{c.from || "—"}</span>
                                <span className="px-2.5 py-1.5 font-semibold break-words text-success">{c.to || "—"}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {r.ip && <div className="mt-1.5 text-[11px] text-muted">From {r.ip}</div>}
                      </details>
                    )}
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
