import { asc, eq } from "drizzle-orm";
import { PageBody, PageHeader } from "@/components/ui/page";
import { requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { Department } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { AssetForm } from "../asset-form";

export const metadata = { title: "Add asset" };

export default async function Page() {
  await requirePagePermission("assets.manage");
  const [settings, departments] = await Promise.all([
    getSettings(),
    db().select({ _id: Department._id, name: Department.name }).from(Department).where(eq(Department.active, true)).orderBy(asc(Department.name)),
  ]);
  return (
    <PageBody className="max-w-3xl">
      <PageHeader back={{ href: "/assets", label: "Assets" }} title="Add asset" />
      <AssetForm categories={settings.assetCategories} departments={departments.map((d) => ({ id: d._id, name: d.name }))} storageConfigured={env.storage.configured} />
    </PageBody>
  );
}
