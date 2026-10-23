import { PageBody, PageHeader } from "@/components/ui/page";
import { requirePagePermission } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { env } from "@/lib/env";
import { Department } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { AssetForm } from "../asset-form";

export const metadata = { title: "Add asset" };

export default async function Page() {
  await requirePagePermission("assets.manage");
  await connectDB();
  const [settings, departments] = await Promise.all([getSettings(), Department.find({ active: true }, { name: 1 }).sort({ name: 1 }).lean()]);
  return (
    <PageBody className="max-w-3xl">
      <PageHeader back={{ href: "/assets", label: "Assets" }} title="Add asset" />
      <AssetForm categories={settings.assetCategories} departments={departments.map((d) => ({ id: d._id.toString(), name: d.name }))} storageConfigured={env.spaces.configured} />
    </PageBody>
  );
}
