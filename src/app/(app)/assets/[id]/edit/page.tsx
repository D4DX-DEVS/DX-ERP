import { notFound } from "next/navigation";
import { PageBody, PageHeader } from "@/components/ui/page";
import { requirePagePermission } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
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
  await connectDB();
  const [asset, settings, departments] = await Promise.all([
    Asset.findById(id).lean(),
    getSettings(),
    Department.find({ active: true }, { name: 1 }).sort({ name: 1 }).lean(),
  ]);
  if (!asset) notFound();
  // Keep the asset's current department selectable even if it has been deactivated since.
  const current = asset.department && !departments.some((d) => d._id.equals(asset.department!)) ? await Department.findById(asset.department, { name: 1 }).lean() : null;
  const options = [...departments, ...(current ? [current] : [])].map((d) => ({ id: d._id.toString(), name: d.name }));

  return (
    <PageBody className="max-w-3xl">
      <PageHeader back={{ href: `/assets/${id}`, label: asset.name }} title={`Edit ${asset.assetNo}`} />
      <AssetForm
        categories={settings.assetCategories}
        departments={options}
        storageConfigured={env.spaces.configured}
        asset={{
          id,
          assetNo: asset.assetNo,
          name: asset.name,
          category: asset.category,
          brand: asset.brand,
          model: asset.model,
          serialNo: asset.serialNo,
          purchaseDate: asset.purchaseDate,
          cost: asset.cost,
          vendor: asset.vendor,
          invoiceRef: asset.invoiceRef,
          warrantyUntil: asset.warrantyUntil,
          serviceProvider: asset.serviceProvider,
          nextServiceDate: asset.nextServiceDate,
          department: asset.department?.toString(),
          location: asset.location,
          condition: asset.condition,
          notes: asset.notes,
          documents: asset.documents.map((d) => ({ id: d.file.toString(), name: d.name, size: d.size ?? 0, mime: d.mime ?? "" })),
        }}
      />
    </PageBody>
  );
}
