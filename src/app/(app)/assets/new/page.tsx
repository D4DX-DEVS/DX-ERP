import { asc, eq } from "drizzle-orm";
import { PageBody, PageHeader } from "@/components/ui/page";
import { requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { Department } from "@/lib/models";
import { param, type SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { AssetForm } from "../asset-form";

export const metadata = { title: "Add asset" };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePagePermission("assets.manage");
  const kind = param(await searchParams, "kind") === "company" ? "company" : "staff";
  const [settings, departments] = await Promise.all([
    getSettings(),
    db().select({ _id: Department._id, name: Department.name }).from(Department).where(eq(Department.active, true)).orderBy(asc(Department.name)),
  ]);
  return (
    <PageBody className="max-w-3xl">
      <PageHeader back={kind === "company" ? { href: "/assets?kind=company", label: "Company assets" } : { href: "/assets", label: "Assets" }} title="Add asset" />
      <AssetForm
        defaultKind={kind}
        categories={settings.assetCategories}
        companyCategories={settings.companyAssetCategories}
        departments={departments.map((d) => ({ id: d._id, name: d.name }))}
        storageConfigured={env.storage.configured}
      />
    </PageBody>
  );
}
