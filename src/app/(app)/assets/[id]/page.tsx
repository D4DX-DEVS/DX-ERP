import { forbidden, notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { PersonCell } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { Chip, StatusChip } from "@/components/ui/chip";
import { AttachmentList } from "@/components/ui/file-upload";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Timeline } from "@/components/ui/timeline";
import { can, getCurrentUser, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { inr, titleCase } from "@/lib/format";
import { Asset, Department, User } from "@/lib/models";
import { peopleOptions } from "@/lib/people";
import { fmtDate, todayKey } from "@/lib/time";
import { isObjectId } from "@/lib/validation";
import { AssetActions } from "../asset-actions";
import { ASSET_KIND_LABELS, HISTORY_ACTIONS, serviceState, warrantyState } from "../meta";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isObjectId(id)) return { title: "Asset" };
  const user = await getCurrentUser();
  if (!user || !can(user, "assets.view")) return { title: "Asset" };
  const [asset] = await db().select({ assetNo: Asset.assetNo, name: Asset.name }).from(Asset).where(eq(Asset._id, id)).limit(1);
  return { title: asset ? `${asset.assetNo} · ${asset.name}` : "Asset" };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  const [asset] = await db().select().from(Asset).where(eq(Asset._id, id)).limit(1);
  if (!asset) notFound();

  // Asset managers see everything; the person an asset is issued to may see their own item (read-only, no cost or documents).
  const canViewAll = can(user, "assets.view");
  const canManage = can(user, "assets.manage");
  if (!canViewAll && asset.assignedTo !== user.id) forbidden();

  const [[holder], [dept], people, departments] = await Promise.all([
    asset.assignedTo ? db().select({ _id: User._id, name: User.name, employeeId: User.employeeId, photo: User.photo }).from(User).where(eq(User._id, asset.assignedTo)).limit(1) : Promise.resolve([]),
    asset.department ? db().select({ name: Department.name }).from(Department).where(eq(Department._id, asset.department)).limit(1) : Promise.resolve([]),
    canManage && asset.kind === "staff" ? peopleOptions() : [],
    canManage ? db().select({ _id: Department._id, name: Department.name }).from(Department).where(eq(Department.active, true)).orderBy(asc(Department.name)) : [],
  ]);

  const today = todayKey();
  const active = asset.status !== "retired" && asset.status !== "lost";
  const warranty = active ? warrantyState(asset.warrantyUntil ?? undefined, today) : null;
  const service = active ? serviceState(asset.nextServiceDate ?? undefined, today) : null;
  const history = [...asset.history].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const since = holder ? history.find((h) => h.action === "issued" || h.action === "transferred")?.at : undefined;

  const holderIsViewer = holder?._id === user.id;

  return (
    <PageBody>
      <PageHeader
        back={canViewAll ? (asset.kind === "company" ? { href: "/assets?kind=company", label: "Company assets" } : { href: "/assets", label: "Assets" }) : undefined}
        overline={canViewAll ? undefined : "My equipment"}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {asset.name}
            <StatusChip domain="asset" value={asset.status} />
          </span>
        }
        description={`${asset.assetNo} · ${ASSET_KIND_LABELS[asset.kind]?.label ?? "Asset"} · ${asset.category}${asset.serialNo ? ` · Serial ${asset.serialNo}` : ""}`}
        actions={
          canManage ? (
            <>
              <ButtonLink href={`/assets/${id}/edit`} variant="secondary">
                Edit
              </ButtonLink>
              <AssetActions
                id={id}
                assetKind={asset.kind}
                status={asset.status}
                condition={asset.condition}
                holder={holder?.name}
                people={people}
                departments={departments.map((d) => ({ id: d._id, name: d.name }))}
                today={today}
              />
            </>
          ) : undefined
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-2">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DetailList
                columns={2}
                items={[
                  { label: "Category", value: asset.category },
                  { label: "Condition", value: <StatusChip domain="assetCondition" value={asset.condition} /> },
                  { label: "Brand", value: asset.brand },
                  { label: "Model", value: asset.model },
                  { label: "Serial number", value: asset.serialNo ? <span className="font-mono text-[13px]">{asset.serialNo}</span> : undefined },
                  { label: "Department", value: dept?.name },
                  { label: "Location", value: asset.location },
                  { label: "Purchase date", value: fmtDate(asset.purchaseDate) },
                  ...(canViewAll
                    ? [
                        { label: "Cost", value: asset.cost ? inr(asset.cost) : undefined },
                        { label: "Vendor", value: asset.vendor },
                        { label: "Invoice reference", value: asset.invoiceRef },
                      ]
                    : []),
                  {
                    label: "Warranty until",
                    value: asset.warrantyUntil ? (
                      <span className="flex flex-wrap items-center gap-2">
                        {fmtDate(asset.warrantyUntil)}
                        {warranty && (
                          <Chip tone={warranty.tone} size="sm">
                            {warranty.label}
                          </Chip>
                        )}
                      </span>
                    ) : undefined,
                  },
                  { label: "Service provider", value: asset.serviceProvider },
                  {
                    label: "Next service",
                    value: asset.nextServiceDate ? (
                      <span className="flex flex-wrap items-center gap-2">
                        {fmtDate(asset.nextServiceDate)}
                        {service && (
                          <Chip tone={service.tone} size="sm">
                            {service.label}
                          </Chip>
                        )}
                      </span>
                    ) : undefined,
                  },
                  { label: "Notes", value: asset.notes ? <span className="whitespace-pre-line">{asset.notes}</span> : undefined, full: true },
                ]}
              />
            </CardBody>
          </Card>

          {canViewAll && (
            <Card>
              <CardHeader title="History" subtitle="Every issue, return, transfer, repair and status change." />
              <CardBody>
                <Timeline
                  empty="No history recorded yet."
                  items={history.map((h, i) => ({
                    id: h._id ?? String(i),
                    title: (
                      <>
                        {HISTORY_ACTIONS[h.action]?.label ?? titleCase(h.action)}
                        {h.userName ? <span className="font-normal text-ink-2"> · {h.userName}</span> : null}
                      </>
                    ),
                    meta: h.byName ? `by ${h.byName}` : undefined,
                    at: h.at,
                    tone: HISTORY_ACTIONS[h.action]?.tone,
                    body: [h.from && h.to ? `${h.from} → ${h.to}` : h.to, h.note].filter(Boolean).join("\n") || undefined,
                  }))}
                />
              </CardBody>
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader title={asset.kind === "company" ? "Placement" : "Assignment"} />
            <CardBody className="flex flex-col gap-3">
              {asset.kind === "company" ? (
                <p className="text-sm text-ink-2">
                  Company asset — kept in the office, not issued to people.
                  {dept || asset.location ? ` ${[dept?.name, asset.location].filter(Boolean).join(" · ")}.` : " Add a department or location from Edit."}
                </p>
              ) : holder ? (
                <>
                  <PersonCell name={holder.name} photo={holder.photo ?? undefined} sub={holder.employeeId} />
                  <p className="text-[13px] text-muted">
                    {holderIsViewer ? "This item is issued to you" : "Currently holding this asset"}
                    {since ? ` since ${fmtDate(since)}` : ""}.
                  </p>
                </>
              ) : (
                <p className="text-sm text-ink-2">
                  {asset.status === "available" ? "In stock, ready to issue." : `Not assigned (${asset.status.replace("_", " ")}).`}
                  {dept || asset.location ? ` ${[dept?.name, asset.location].filter(Boolean).join(" · ")}.` : ""}
                </p>
              )}
            </CardBody>
          </Card>

          {canViewAll && (
            <Card>
              <CardHeader title="Documents" />
              <CardBody>
                <AttachmentList files={asset.documents.map((d) => ({ file: d.file, name: d.name, size: d.size }))} empty="No documents attached." />
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </PageBody>
  );
}
