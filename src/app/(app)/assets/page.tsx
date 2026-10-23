import Link from "next/link";
import { Boxes, Plus } from "lucide-react";
import { PersonFilter } from "../audit/person-filter";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip, StatusChip } from "@/components/ui/chip";
import { ChipFilters, ClearFilters, FilterBar, Pagination, SearchInput, SelectFilter } from "@/components/ui/filters";
import { EmptyState, PageBody, PageHeader, StatCard } from "@/components/ui/page";
import { EmptyRow, TableWrap, THead, Td, Th, Tr } from "@/components/ui/table";
import { can, requirePagePermission } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { inrCompact } from "@/lib/format";
import { Asset, Department } from "@/lib/models";
import { namesFor, peopleOptions } from "@/lib/people";
import { idParam, pageParam, PAGE_SIZE, param, searchRegex, type SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { addDays, fmtDate, todayKey } from "@/lib/time";
import { ASSET_STATUSES, warrantyState } from "./meta";

export const metadata = { title: "Assets & inventory" };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePagePermission("assets.view");
  const canManage = can(user, "assets.manage");
  const sp = await searchParams;
  await connectDB();

  const today = todayKey();
  const soon = addDays(today, 30);
  const page = pageParam(sp);
  const status = param(sp, "status");
  const category = param(sp, "category");
  const assignee = idParam(sp, "assignee");
  const department = idParam(sp, "department");
  const warranty = param(sp, "warranty") === "soon";
  const rx = searchRegex(param(sp, "q"));

  const conditions: Record<string, unknown>[] = [];
  if ((ASSET_STATUSES as readonly string[]).includes(status)) conditions.push({ status });
  if (category) conditions.push({ category });
  if (assignee) conditions.push({ assignedTo: assignee });
  if (department) conditions.push({ department });
  if (warranty) conditions.push({ warrantyUntil: { $gte: today, $lte: soon }, status: { $nin: ["retired", "lost"] } });
  if (rx) conditions.push({ $or: [{ name: rx }, { assetNo: rx }, { serialNo: rx }, { brand: rx }, { model: rx }] });
  const filter = conditions.length ? { $and: conditions } : {};

  const [settings, rows, total, statusRows, categoryRows, cost, holders, soonCount, departments, people] = await Promise.all([
    getSettings(),
    Asset.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    Asset.countDocuments(filter),
    Asset.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
    Asset.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$category", n: { $sum: 1 } } }]),
    Asset.aggregate<{ _id: null; total: number }>([{ $group: { _id: null, total: { $sum: "$cost" } } }]),
    Asset.distinct("assignedTo", { status: "assigned" }),
    Asset.countDocuments({ warrantyUntil: { $gte: today, $lte: soon }, status: { $nin: ["retired", "lost"] } }),
    Department.find({}, { name: 1 }).sort({ name: 1 }).lean(),
    peopleOptions({ includeExited: true }),
  ]);

  const byStatus = Object.fromEntries(statusRows.map((r) => [r._id, r.n]));
  const totalAssets = statusRows.reduce((n, r) => n + r.n, 0);
  const counts = new Map(categoryRows.map((r) => [r._id, r.n]));
  const knownCategories = [...settings.assetCategories, ...categoryRows.map((r) => r._id).filter((c) => c && !settings.assetCategories.includes(c))];
  const categoryChips = knownCategories.filter((c) => (counts.get(c) ?? 0) > 0).map((c) => ({ value: c, label: c, count: counts.get(c) }));

  const holderNames = await namesFor(rows.map((r) => r.assignedTo));
  const deptNames = new Map(departments.map((d) => [d._id.toString(), d.name]));
  const filtered = conditions.length > 0;

  return (
    <PageBody>
      <PageHeader
        overline="Operations"
        title="Assets & inventory"
        actions={
          canManage ? (
            <ButtonLink href="/assets/new" icon={<Plus className="size-4" />}>
              Add asset
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Total assets" value={totalAssets} sub={cost[0]?.total ? `cost ${inrCompact(cost[0].total)}` : undefined} />
        <StatCard label="Assigned" value={byStatus.assigned ?? 0} sub={`to ${holders.length} ${holders.length === 1 ? "person" : "people"}`} href="/assets?status=assigned" />
        <StatCard label="Available" value={byStatus.available ?? 0} sub="ready to issue" href="/assets?status=available" />
        <StatCard label="In repair" value={byStatus.in_repair ?? 0} sub={byStatus.damaged ? `${byStatus.damaged} damaged` : "none damaged"} href="/assets?status=in_repair" />
        <StatCard label="Warranty ending · 30 d" value={soonCount} sub={soonCount ? "view the list" : "nothing expiring"} tone={soonCount ? "alert" : "default"} href="/assets?warranty=soon" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-line-soft p-4">
          {categoryChips.length > 0 && <ChipFilters param="category" allLabel="All" options={categoryChips} />}
          <FilterBar>
            <SearchInput placeholder="Search name, number or serial" />
            <SelectFilter param="status" allLabel="All statuses" options={ASSET_STATUSES.map((s) => ({ value: s, label: s.replace("_", " ").replace(/^\w/, (c) => c.toUpperCase()) }))} />
            <SelectFilter param="department" allLabel="All departments" options={departments.map((d) => ({ value: d._id.toString(), label: d.name }))} />
            <PersonFilter param="assignee" options={people} placeholder="Assigned to anyone" />
            {warranty && <Chip tone="orange">Warranty ending in 30 days</Chip>}
            <ClearFilters />
          </FilterBar>
        </div>
        {totalAssets === 0 ? (
          <EmptyState
            icon={<Boxes className="size-5" />}
            title="No assets yet"
            description="Add laptops, monitors, phones and other equipment to track who has what, warranties and servicing."
            action={
              canManage ? (
                <ButtonLink href="/assets/new" icon={<Plus className="size-4" />}>
                  Add the first asset
                </ButtonLink>
              ) : undefined
            }
          />
        ) : (
          <TableWrap>
            <THead>
              <Th>Asset</Th>
              <Th>Serial</Th>
              <Th>Assigned to</Th>
              <Th>Purchased</Th>
              <Th>Warranty</Th>
              <Th>Condition</Th>
              <Th>Status</Th>
            </THead>
            <tbody>
              {rows.length === 0 && <EmptyRow colSpan={7}>{filtered ? "No assets match these filters." : "No assets."}</EmptyRow>}
              {rows.map((a) => {
                const id = a._id.toString();
                const holder = a.assignedTo ? holderNames.get(a.assignedTo.toString()) : undefined;
                const dept = a.department ? deptNames.get(a.department.toString()) : undefined;
                const warn = a.status === "retired" || a.status === "lost" ? null : warrantyState(a.warrantyUntil, today);
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
                        <span className="text-ink-2">{[dept, a.location].filter(Boolean).join(" · ") || (a.status === "available" ? "In stock" : "—")}</span>
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
