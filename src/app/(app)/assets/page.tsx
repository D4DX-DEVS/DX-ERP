import Link from "next/link";
import { Boxes, Building2, Laptop, Plus } from "lucide-react";
import { and, asc, count, countDistinct, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { PersonFilter } from "../audit/person-filter";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { HBarList } from "@/components/ui/charts";
import { LinkTabs } from "@/components/ui/tabs";
import { Chip, StatusChip } from "@/components/ui/chip";
import { ChipFilters, ClearFilters, FilterBar, Pagination, SearchInput, SelectFilter } from "@/components/ui/filters";
import { EmptyState, PageBody, PageHeader, StatCard } from "@/components/ui/page";
import { EmptyRow, TableWrap, THead, Td, Th, Tr } from "@/components/ui/table";
import { can, requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { inr, inrCompact } from "@/lib/format";
import { Asset, Department } from "@/lib/models";
import { namesFor, peopleOptions } from "@/lib/people";
import { idParam, pageParam, PAGE_SIZE, param, type SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { notInList, searchAny } from "@/lib/sql";
import { addDays, fmtDate, todayKey } from "@/lib/time";
import { statusLabel } from "@/lib/status";
import { ASSET_KIND_LABELS, ASSET_STATUSES, warrantyState, type AssetKindKey } from "./meta";

/** Statuses that make sense for each kind (company assets are never issued; staff assets are never "in use"). */
const KIND_STATUSES: Record<AssetKindKey, readonly string[]> = {
  staff: ASSET_STATUSES.filter((s) => s !== "in_use"),
  company: ASSET_STATUSES.filter((s) => s !== "available" && s !== "assigned"),
};

export const metadata = { title: "Assets & inventory" };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePagePermission("assets.view");
  const canManage = can(user, "assets.manage");
  const sp = await searchParams;
  const kind: AssetKindKey = param(sp, "kind") === "company" ? "company" : "staff";
  const isCompany = kind === "company";

  const today = todayKey();
  const soon = addDays(today, 30);
  const page = pageParam(sp);
  const status = param(sp, "status");
  const category = param(sp, "category");
  const assignee = idParam(sp, "assignee");
  const department = idParam(sp, "department");
  const warranty = param(sp, "warranty") === "soon";
  const search = searchAny(param(sp, "q"), Asset.name, Asset.assetNo, Asset.serialNo, Asset.brand, Asset.model);

  const warrantySoon = and(eq(Asset.kind, kind), gte(Asset.warrantyUntil, today), lte(Asset.warrantyUntil, soon), notInList(Asset.status, ["retired", "lost"]));
  const conditions: SQL[] = [eq(Asset.kind, kind)];
  if ((ASSET_STATUSES as readonly string[]).includes(status)) conditions.push(eq(Asset.status, status as (typeof ASSET_STATUSES)[number]));
  if (category) conditions.push(eq(Asset.category, category));
  if (assignee && !isCompany) conditions.push(eq(Asset.assignedTo, assignee));
  if (department) conditions.push(eq(Asset.department, department));
  if (warranty && warrantySoon) conditions.push(warrantySoon);
  if (search) conditions.push(search);
  const filter = and(...conditions);

  const [settings, rows, total, groups, [holders], soonCount, departments, people, kindCounts] = await Promise.all([
    getSettings(),
    db()
      .select({
        _id: Asset._id,
        name: Asset.name,
        assetNo: Asset.assetNo,
        category: Asset.category,
        serialNo: Asset.serialNo,
        assignedTo: Asset.assignedTo,
        department: Asset.department,
        location: Asset.location,
        purchaseDate: Asset.purchaseDate,
        warrantyUntil: Asset.warrantyUntil,
        condition: Asset.condition,
        status: Asset.status,
      })
      .from(Asset)
      .where(filter)
      .orderBy(desc(Asset.createdAt), desc(Asset._id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db().$count(Asset, filter),
    // Counts and cost per status / category of this kind, in one pass over the table.
    db()
      .select({ status: Asset.status, category: Asset.category, n: count(), cost: sql<number>`coalesce(sum(${Asset.cost}), 0)`.mapWith(Number) })
      .from(Asset)
      .where(eq(Asset.kind, kind))
      .groupBy(Asset.status, Asset.category),
    db().select({ n: countDistinct(Asset.assignedTo) }).from(Asset).where(eq(Asset.status, "assigned")),
    db().$count(Asset, warrantySoon),
    db().select({ _id: Department._id, name: Department.name }).from(Department).orderBy(asc(Department.name)),
    isCompany ? Promise.resolve([]) : peopleOptions({ includeExited: true }),
    db().select({ kind: Asset.kind, n: count() }).from(Asset).groupBy(Asset.kind),
  ]);

  const byStatus: Record<string, number> = {};
  const counts = new Map<string, number>();
  const costByCategory = new Map<string, number>();
  let activeCost = 0;
  let totalAssets = 0;
  let totalCost = 0;
  for (const g of groups) {
    byStatus[g.status] = (byStatus[g.status] ?? 0) + g.n;
    counts.set(g.category, (counts.get(g.category) ?? 0) + g.n);
    totalAssets += g.n;
    totalCost += g.cost;
    if (g.status !== "retired" && g.status !== "lost") {
      costByCategory.set(g.category, (costByCategory.get(g.category) ?? 0) + g.cost);
      activeCost += g.cost;
    }
  }
  const kindCount = new Map(kindCounts.map((k) => [k.kind, k.n]));
  const holderCount = holders?.n ?? 0;
  const listed = isCompany ? settings.companyAssetCategories : settings.assetCategories;
  const knownCategories = [...listed, ...[...counts.keys()].filter((c) => c && !listed.includes(c))];
  const categoryChips = knownCategories.filter((c) => (counts.get(c) ?? 0) > 0).map((c) => ({ value: c, label: c, count: counts.get(c) }));

  const holderNames = await namesFor(rows.map((r) => r.assignedTo));
  const deptNames = new Map(departments.map((d) => [d._id, d.name]));
  const filtered = conditions.length > 1;
  const withKind = (q: string) => (isCompany ? `/assets?kind=company&${q}` : `/assets?${q}`);
  const addHref = isCompany ? "/assets/new?kind=company" : "/assets/new";

  return (
    <PageBody>
      <PageHeader
        overline="Operations"
        title="Assets & inventory"
        actions={
          canManage ? (
            <ButtonLink href={addHref} icon={<Plus className="size-4" />}>
              {isCompany ? "Add company asset" : "Add asset"}
            </ButtonLink>
          ) : undefined
        }
      />

      <LinkTabs
        items={[
          { href: "/assets", label: ASSET_KIND_LABELS.staff.plural, icon: <Laptop className="size-[18px]" />, active: !isCompany, count: kindCount.get("staff") ?? 0 },
          { href: "/assets?kind=company", label: ASSET_KIND_LABELS.company.plural, icon: <Building2 className="size-[18px]" />, active: isCompany, count: kindCount.get("company") ?? 0 },
        ]}
      />

      {isCompany ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Company assets" value={totalAssets} sub={totalCost ? `bought for ${inrCompact(totalCost)}` : undefined} />
          <StatCard label="In use" value={byStatus.in_use ?? 0} sub={activeCost ? `worth ${inrCompact(activeCost)}` : undefined} href={withKind("status=in_use")} />
          <StatCard label="In repair" value={byStatus.in_repair ?? 0} sub={byStatus.damaged ? `${byStatus.damaged} damaged` : "none damaged"} href={withKind("status=in_repair")} />
          <StatCard label="Retired / lost" value={(byStatus.retired ?? 0) + (byStatus.lost ?? 0)} href={withKind("status=retired")} />
          <StatCard label="Warranty ending · 30 d" value={soonCount} sub={soonCount ? "view the list" : "nothing expiring"} tone={soonCount ? "alert" : "default"} href={withKind("warranty=soon")} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Total assets" value={totalAssets} sub={totalCost ? `cost ${inrCompact(totalCost)}` : undefined} />
          <StatCard label="Assigned" value={byStatus.assigned ?? 0} sub={`to ${holderCount} ${holderCount === 1 ? "person" : "people"}`} href="/assets?status=assigned" />
          <StatCard label="Available" value={byStatus.available ?? 0} sub="ready to issue" href="/assets?status=available" />
          <StatCard label="In repair" value={byStatus.in_repair ?? 0} sub={byStatus.damaged ? `${byStatus.damaged} damaged` : "none damaged"} href="/assets?status=in_repair" />
          <StatCard label="Warranty ending · 30 d" value={soonCount} sub={soonCount ? "view the list" : "nothing expiring"} tone={soonCount ? "alert" : "default"} href="/assets?warranty=soon" />
        </div>
      )}

      {isCompany && costByCategory.size > 0 && (
        <Card>
          <CardHeader
            title="Value by category"
            subtitle={`Purchase cost of company assets still in service · ${inr(activeCost)}`}
            action={
              <Link href="/reports/asset-register?kind=company" className="text-[13px] font-semibold text-brand-600 hover:underline">
                Full report →
              </Link>
            }
          />
          <CardBody>
            <HBarList
              format="inrCompact"
              rows={[...costByCategory.entries()]
                .sort((x, y) => y[1] - x[1])
                .map(([label, value]) => ({ label: label || "Uncategorised", value, hint: `${counts.get(label) ?? 0} assets` }))}
            />
          </CardBody>
        </Card>
      )}

      <Card>
        <div className="flex flex-col gap-3 border-b border-line-soft p-4">
          {categoryChips.length > 0 && <ChipFilters param="category" allLabel="All" options={categoryChips} />}
          <FilterBar>
            <SearchInput placeholder="Search name, number or serial" />
            <SelectFilter param="status" allLabel="All statuses" options={KIND_STATUSES[kind].map((s) => ({ value: s, label: statusLabel("asset", s) }))} />
            <SelectFilter param="department" allLabel="All departments" options={departments.map((d) => ({ value: d._id, label: d.name }))} />
            {!isCompany && <PersonFilter param="assignee" options={people} placeholder="Assigned to anyone" />}
            {warranty && <Chip tone="orange">Warranty ending in 30 days</Chip>}
            <ClearFilters keep={["kind"]} />
          </FilterBar>
        </div>
        {totalAssets === 0 ? (
          <EmptyState
            icon={isCompany ? <Building2 className="size-5" /> : <Boxes className="size-5" />}
            title={isCompany ? "No company assets yet" : "No assets yet"}
            description={
              isCompany
                ? "Record what the company buys for the office — ACs, inverters, furniture, printers — to track value, warranties and servicing for reports."
                : "Add laptops, monitors, phones and other equipment to track who has what, warranties and servicing."
            }
            action={
              canManage ? (
                <ButtonLink href={addHref} icon={<Plus className="size-4" />}>
                  {isCompany ? "Add the first company asset" : "Add the first asset"}
                </ButtonLink>
              ) : undefined
            }
          />
        ) : (
          <TableWrap>
            <THead>
              <Th>Asset</Th>
              <Th>Serial</Th>
              <Th>{isCompany ? "Location" : "Assigned to"}</Th>
              <Th>Purchased</Th>
              <Th>Warranty</Th>
              <Th>Condition</Th>
              <Th>Status</Th>
            </THead>
            <tbody>
              {rows.length === 0 && <EmptyRow colSpan={7}>{filtered ? "No assets match these filters." : "No assets."}</EmptyRow>}
              {rows.map((a) => {
                const id = a._id;
                const holder = a.assignedTo ? holderNames.get(a.assignedTo) : undefined;
                const dept = a.department ? deptNames.get(a.department) : undefined;
                const warn = a.status === "retired" || a.status === "lost" ? null : warrantyState(a.warrantyUntil ?? undefined, today);
                return (
                  <Tr key={id}>
                    <Td>
                      <Link href={`/assets/${id}`} className="font-semibold text-ink hover:text-brand-600">
                        {a.name}
                      </Link>
                      <div className="text-xs text-muted">
                        {a.assetNo} · {a.category}
                      </div>
                    </Td>
                    <Td className="font-mono text-xs text-ink-2">{a.serialNo ?? "—"}</Td>
                    <Td>
                      {holder ?? (
                        <span className="text-ink-2">{[dept, a.location].filter(Boolean).join(" · ") || (a.status === "available" ? "In stock" : a.status === "in_use" ? "In use" : "—")}</span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">{fmtDate(a.purchaseDate)}</Td>
                    <Td className="whitespace-nowrap">
                      <span className={warn ? "font-semibold text-tone-orange" : "text-ink-2"}>{fmtDate(a.warrantyUntil)}</span>
                      {warn && (
                        <div className="mt-0.5">
                          <Chip tone={warn.tone} size="sm" dot={false}>
                            {warn.label}
                          </Chip>
                        </div>
                      )}
                    </Td>
                    <Td>
                      <StatusChip domain="assetCondition" value={a.condition} />
                    </Td>
                    <Td>
                      <StatusChip domain="asset" value={a.status} />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
        {totalAssets > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={total} />}
      </Card>
    </PageBody>
  );
}
