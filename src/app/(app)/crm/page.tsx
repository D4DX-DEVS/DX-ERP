import Link from "next/link";
import { Plus, Search, Users } from "lucide-react";
import { and, asc, desc, eq, lte, or, sql, type SQL } from "drizzle-orm";
import { can, requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Lead } from "@/lib/models";
import { peopleOptions } from "@/lib/people";
import { pageParam, PAGE_SIZE, param, sortParam, withParams, idParam, type SearchParams, type SortChoices } from "@/lib/query";
import { nocase, searchAny } from "@/lib/sql";
import { getSettings } from "@/lib/settings";
import { inr, inrCompact, plural } from "@/lib/format";
import { fmtDate } from "@/lib/time";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip, OptionChip } from "@/components/ui/chip";
import { ClearFilters, FilterBar, Pagination, SearchInput, SelectFilter, SortSelect } from "@/components/ui/filters";
import { PageBody, PageHeader, StatCard } from "@/components/ui/page";
import { Segmented } from "@/components/ui/tabs";
import { EmptyRow, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { hiddenClientIds, notHiddenClient } from "./_lib/access";
import { ageLabel, endOfToday, followUpView, isPast } from "./_lib/clock";
import { closedThisFiscalYear, pipelineMetrics, userCards } from "./_lib/queries";
import { LeadCard, type LeadCardData } from "./_components/lead-card";
import type { StageOption } from "./_components/lead-stage-menu";

export const metadata = { title: "Leads & pipeline" };

const BOARD_CARD_LIMIT = 25;

/** Lead columns the board and list need (the history / attachments JSON stays in the database). */
const leadColumns = {
  _id: Lead._id,
  leadNo: Lead.leadNo,
  title: Lead.title,
  companyName: Lead.companyName,
  expectedValue: Lead.expectedValue,
  assignedTo: Lead.assignedTo,
  stage: Lead.stage,
  status: Lead.status,
  source: Lead.source,
  lostReason: Lead.lostReason,
  nextFollowUp: Lead.nextFollowUp,
  closedAt: Lead.closedAt,
  createdAt: Lead.createdAt,
  updatedAt: Lead.updatedAt,
};

const SORTS = {
  updated: { label: "Recently updated", order: [desc(Lead.updatedAt)] },
  newest: { label: "Newest first", order: [desc(Lead.createdAt)] },
  oldest: { label: "Oldest first", order: [asc(Lead.createdAt)] },
  title: { label: "Title A–Z", order: [asc(nocase(Lead.title)), desc(Lead.updatedAt)] },
  value: { label: "Value (high to low)", order: [desc(Lead.expectedValue), desc(Lead.updatedAt)] },
  followUp: { label: "Next follow-up (soonest)", order: [asc(sql`${Lead.nextFollowUp} is null`), asc(Lead.nextFollowUp), desc(Lead.updatedAt)] },
} satisfies SortChoices<SQL[]>;

export default async function PipelinePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePagePermission("crm.view");
  const sp = await searchParams;
  const settings = await getSettings();
  const stages = settings.pipelineStages;
  const canManage = can(user, "crm.manage");
  const canProposal = can(user, "proposals.manage");

  const view = param(sp, "view") === "list" ? "list" : "board";
  const status = (["open", "won", "lost"].includes(param(sp, "status")) ? param(sp, "status") : "") as "" | "open" | "won" | "lost";
  const owner = idParam(sp, "owner");
  const source = param(sp, "source");
  const q = param(sp, "q");
  const dueOnly = param(sp, "due") === "1";
  const page = pageParam(sp);
  const sort = sortParam(sp, SORTS);

  const hidden = await hiddenClientIds(user);
  const scope = notHiddenClient(hidden, Lead.client);

  const conds: (SQL | undefined)[] = [scope];
  if (owner) conds.push(eq(Lead.assignedTo, owner));
  if (source) conds.push(eq(Lead.source, source));
  if (status) conds.push(eq(Lead.status, status));
  else conds.push(or(eq(Lead.status, "open"), closedThisFiscalYear("won"), closedThisFiscalYear("lost")));
  if (dueOnly) conds.push(and(eq(Lead.status, "open"), lte(Lead.nextFollowUp, endOfToday())));
  conds.push(searchAny(q, Lead.title, Lead.companyName, Lead.contactName, Lead.leadNo));
  const filter = and(...conds);

  const [metrics, dueRows, people, sources] = await Promise.all([
    pipelineMetrics(scope, stages),
    db()
      .select({ nextFollowUp: Lead.nextFollowUp })
      .from(Lead)
      .where(and(scope, eq(Lead.status, "open"), lte(Lead.nextFollowUp, endOfToday()))),
    peopleOptions(),
    db().selectDistinct({ source: Lead.source }).from(Lead).where(scope),
  ]);
  const dueCount = dueRows.length;
  const overdueCount = dueRows.filter((l) => isPast(l.nextFollowUp)).length;
  const sourceOptions = [...new Set([...settings.leadSources, ...sources.map((r) => r.source)])]
    .filter((s): s is string => Boolean(s))
    .map((s) => ({ value: s, label: s }));

  const stageOptions: StageOption[] = stages.map((s) => ({ key: s.key, label: s.label, category: s.category }));

  const header = (
    <PageHeader
      overline="Sales"
      title="Leads & pipeline"
      actions={
        <>
          <Segmented
            items={[
              { href: withParams("/crm", sp, { view: null }), label: "Board", active: view === "board" },
              { href: withParams("/crm", sp, { view: "list" }), label: "List", active: view === "list" },
            ]}
          />
          <ButtonLink href="/crm/clients" variant="secondary" icon={<Users className="size-4" aria-hidden />}>
            Clients
          </ButtonLink>
          {canManage && (
            <ButtonLink href="/crm/leads/new" icon={<Plus className="size-4" aria-hidden />}>
              New lead
            </ButtonLink>
          )}
        </>
      }
    />
  );

  const stats = (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <StatCard label="Open pipeline" value={inrCompact(metrics.openValue)} sub={`${plural(metrics.openCount, "lead")} · weighted ${inrCompact(metrics.weightedValue)}`} />
      <StatCard label={`Won · FY ${metrics.fiscalLabel}`} value={<span className="text-success">{inrCompact(metrics.wonValue)}</span>} sub={plural(metrics.wonCount, "deal")} />
      <StatCard label={`Win rate · FY ${metrics.fiscalLabel}`} value={metrics.winRate === null ? "—" : `${metrics.winRate}%`} sub={`${metrics.wonCount} won · ${metrics.lostCount} lost`} />
      <StatCard
        label="Follow-ups due"
        value={dueCount}
        tone={overdueCount > 0 ? "alert" : "default"}
        sub={overdueCount > 0 ? `${overdueCount} overdue` : "none overdue"}
        href={dueOnly ? withParams("/crm", sp, { due: null }) : withParams("/crm", sp, { due: "1" })}
      />
      <StatCard label={`Lost · FY ${metrics.fiscalLabel}`} value={metrics.lostCount} sub={metrics.topLostReason ? `top reason: ${metrics.topLostReason}` : "no losses yet"} className="col-span-2 lg:col-span-1" />
    </div>
  );

  const filters = (
    <FilterBar>
      <SearchInput placeholder="Search leads, companies, contacts" />
      <SelectFilter param="owner" label="Owner" allLabel="All owners" options={people.map((p) => ({ value: p.id, label: p.name }))} />
      <SelectFilter param="source" label="Source" allLabel="All sources" options={sourceOptions} />
      <SelectFilter
        param="status"
        label="Status"
        allLabel="Open + closed this FY"
        options={[
          { value: "open", label: "Open only" },
          { value: "won", label: "Won" },
          { value: "lost", label: "Lost" },
        ]}
      />
      {dueOnly && <Chip tone="red">Follow-up due</Chip>}
      {view === "list" && <SortSelect options={sort.options} />}
      <ClearFilters keep={["view"]} />
    </FilterBar>
  );

  if (view === "list") {
    const [rows, total] = await Promise.all([
      db().select(leadColumns).from(Lead).where(filter).orderBy(...sort.order).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
      db().$count(Lead, filter),
    ]);
    const owners = await userCards(rows.map((r) => r.assignedTo));
    return (
      <PageBody>
        {header}
        {stats}
        {filters}
        <Card>
          <TableWrap phone={[1, 2]} tablet={[1, 2, 3, 5]}>
            <THead>
              <Th>Lead</Th>
              <Th>Stage</Th>
              <Th align="right">Expected value</Th>
              <Th>Owner</Th>
              <Th>Next follow-up</Th>
              <Th>Source</Th>
              <Th align="right">Age</Th>
            </THead>
            <tbody>
              {rows.length === 0 && <EmptyRow colSpan={7}>No leads match these filters.</EmptyRow>}
              {rows.map((l) => {
                const fu = l.status === "open" ? followUpView(l.nextFollowUp) : undefined;
                const o = l.assignedTo ? owners.get(l.assignedTo) : undefined;
                return (
                  <Tr key={l._id}>
                    <Td>
                      <Link href={`/crm/leads/${l._id}`} className="font-semibold text-ink hover:text-brand-600">
                        {l.title}
                      </Link>
                      <div className="text-xs text-muted">
                        {l.leadNo} · {l.companyName}
                      </div>
                    </Td>
                    <Td>
                      <OptionChip options={stages} value={l.stage} />
                    </Td>
                    <Td align="right">{l.expectedValue ? inr(l.expectedValue) : "—"}</Td>
                    <Td>
                      {o ? (
                        <span className="flex items-center gap-2">
                          <Avatar name={o.name} src={o.photo} size="xs" />
                          <span className="truncate">{o.name}</span>
                        </span>
                      ) : (
                        <span className="text-muted">Unassigned</span>
                      )}
                    </Td>
                    <Td className={cn(fu?.overdue && "font-semibold text-danger")}>{fu?.label ?? "—"}</Td>
                    <Td className="text-muted">{l.source ?? "—"}</Td>
                    <Td align="right" className="text-muted">
                      {l.status === "open" ? ageLabel(l.createdAt) : fmtDate(l.closedAt ?? l.updatedAt, "d MMM")}
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

  // Board view
  const leads = await db().select(leadColumns).from(Lead).where(filter).orderBy(desc(Lead.updatedAt)).limit(800);
  const owners = await userCards(leads.map((l) => l.assignedTo));
  const knownKeys = new Set(stages.map((s) => s.key));
  const columns = stages
    .filter((s) => !status || s.category === status)
    .map((s) => ({ key: s.key, label: s.label, probability: s.probability, category: s.category, leads: leads.filter((l) => l.stage === s.key) }));
  const orphans = leads.filter((l) => !knownKeys.has(l.stage));
  if (orphans.length > 0) columns.push({ key: "__other", label: "Other stage", probability: 0, category: "open", leads: orphans });

  const toCard = (l: (typeof leads)[number]): LeadCardData => {
    const o = l.assignedTo ? owners.get(l.assignedTo) : undefined;
    return {
      id: l._id,
      title: l.title,
      company: l.companyName,
      value: l.expectedValue ? inrCompact(l.expectedValue) : null,
      ownerName: o?.name,
      ownerPhoto: o?.photo,
      followUp: l.status === "open" ? followUpView(l.nextFollowUp) : undefined,
      age: ageLabel(l.createdAt),
      source: l.source ?? undefined,
      stage: l.stage,
      status: l.status,
      lostReason: l.lostReason ?? undefined,
    };
  };

  return (
    <PageBody>
      {header}
      {stats}
      {filters}
      {leads.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <span className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <Search className="size-5" aria-hidden />
            </span>
            <p className="text-sm font-semibold text-ink">No leads to show</p>
            <p className="max-w-sm text-[13px] text-muted">{q || owner || source || status || dueOnly ? "Nothing matches the current filters." : "Capture the first enquiry to start building the pipeline."}</p>
            {canManage && !q && !owner && !source && !status && !dueOnly && (
              <ButtonLink href="/crm/leads/new" className="mt-2">
                New lead
              </ButtonLink>
            )}
          </div>
        </Card>
      ) : (
        // Never scrolls sideways: pipeline stages wrap into a grid.
        <div>
          <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {columns.map((c) => {
              const value = c.leads.reduce((s, l) => s + (l.expectedValue ?? 0), 0);
              const weighted = (value * c.probability) / 100;
              const shown = c.leads.slice(0, BOARD_CARD_LIMIT);
              return (
                <section key={c.key} aria-label={c.label} className="flex min-w-0 flex-col gap-2 rounded-[14px] bg-[#EBEEF5] p-2.5">
                  <header className="px-1.5 py-1">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="flex min-w-0 items-center gap-2 font-sans text-[13px] font-semibold text-ink">
                        <span className="truncate">{c.label}</span>
                      </h2>
                      <span className="text-xs font-semibold text-muted tabular">{c.leads.length}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted tabular">
                      <span>{inrCompact(value)}</span>
                      {c.category === "open" && c.leads.length > 0 && <span title={`Probability-weighted at ${c.probability}%`}>· wtd {inrCompact(weighted)}</span>}
                    </div>
                  </header>
                  {shown.length === 0 && <p className="rounded-xl border border-dashed border-line-strong px-3 py-6 text-center text-xs text-muted">No leads</p>}
                  {shown.map((l) => (
                    <LeadCard key={l._id} lead={toCard(l)} stages={stageOptions} canManage={canManage} canCreateProposal={canProposal} />
                  ))}
                  {c.leads.length > shown.length && (
                    <Link href={withParams("/crm", sp, { view: "list" })} className="px-1.5 py-1 text-xs font-semibold text-brand-600 hover:text-brand-800">
                      +{c.leads.length - shown.length} more — open list view
                    </Link>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </PageBody>
  );
}
