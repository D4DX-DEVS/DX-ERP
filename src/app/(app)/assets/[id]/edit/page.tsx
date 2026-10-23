import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { PageBody, PageHeader } from "@/components/ui/page";
import { requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { Asset, Department } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { isObjectId } from "@/lib/validation";
import { AssetForm } from "../../asset-form";

export const metadata = { title: "Edit asset" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("assets.manage");
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  const [[asset], settings, departments] = await Promise.all([
    db().select().from(Asset).where(eq(Asset._id, id)).limit(1),
    getSettings(),
    db().select({ _id: Department._id, name: Department.name }).from(Department).where(eq(Department.active, true)).orderBy(asc(Department.name)),
  ]);
  if (!asset) notFound();
  // Keep the asset's current department selectable even if it has been deactivated since.
  const currentId = asset.department;
  const [current] = currentId && !departments.some((d) => d._id === currentId) ? await db().select({ _id: Department._id, name: Department.name }).from(Department).where(eq(Department._id, currentId)).limit(1) : [];
  const options = [...departments, ...(current ? [current] : [])].map((d) => ({ id: d._id, name: d.name }));

  return (
    <PageBody className="max-w-3xl">
      <PageHeader back={{ href: `/assets/${id}`, label: asset.name }} title={`Edit ${asset.assetNo}`} />
      <AssetForm
        categories={settings.assetCategories}
        departments={options}
        storageConfigured={env.storage.configured}
        asset={{
          id,
          assetNo: asset.assetNo,
          name: asset.name,
          category: asset.category,
          brand: asset.brand ?? undefined,
          model: asset.model ?? undefined,
          serialNo: asset.serialNo ?? undefined,
          purchaseDate: asset.purchaseDate ?? undefined,
          cost: asset.cost,
          vendor: asset.vendor ?? undefined,
          invoiceRef: asset.invoiceRef ?? undefined,
          warrantyUntil: asset.warrantyUntil ?? undefined,
          serviceProvider: asset.serviceProvider ?? undefined,
          nextServiceDate: asset.nextServiceDate ?? undefined,
          department: asset.department ?? undefined,
          location: asset.location ?? undefined,
          condition: asset.condition,
          notes: asset.notes ?? undefined,
          documents: asset.documents.map((d) => ({ id: d.file, name: d.name, size: d.size ?? 0, mime: d.mime ?? "" })),
        }}
      />
    </PageBody>
  );
}
