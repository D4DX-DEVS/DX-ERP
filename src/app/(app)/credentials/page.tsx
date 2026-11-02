import { notFound } from "next/navigation";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { ShieldCheck } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ClearFilters, FilterBar, SearchInput, SelectFilter } from "@/components/ui/filters";
import { Alert, PageBody, PageHeader } from "@/components/ui/page";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { CREDENTIAL_CATEGORIES, Credential, VaultEvent, type CredentialCategory } from "@/lib/models";
import { param, type SearchParams } from "@/lib/query";
import { searchAny } from "@/lib/sql";
import { fmtDateTime } from "@/lib/time";
import { COMPANY_VAULT } from "@/lib/vault/credentials";
import { vaultConfigured } from "@/lib/vault/crypto";
import { CredentialDialog, CredentialList } from "./credentials-panel";
import { CREDENTIAL_CATEGORY_LABELS, CREDENTIAL_EVENT_LABELS } from "./meta";

export const metadata = { title: "Credential storage" };

/** Company logins (social media, email, hosting, banking…) — Super Admin only; values are encrypted and every reveal is logged. */
export default async function CredentialsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  // Not a permission: the page does not exist for anyone but the single env-configured super admin.
  if (!user.isSuperAdmin) notFound();
  const sp = await searchParams;
  const q = param(sp, "q");
  const categoryParam = param(sp, "category");
  const category = (CREDENTIAL_CATEGORIES as readonly string[]).includes(categoryParam) ? (categoryParam as CredentialCategory) : undefined;
  const filter = and(searchAny(q, Credential.platform, Credential.url), category ? eq(Credential.category, category) : undefined);

  const [rows, counts, events] = await Promise.all([
    db()
      .select({ _id: Credential._id, platform: Credential.platform, category: Credential.category, url: Credential.url, valuesUpdatedAt: Credential.valuesUpdatedAt })
      .from(Credential)
      .where(filter)
      .orderBy(asc(Credential.platform))
      .limit(1000),
    db().select({ category: Credential.category, n: count() }).from(Credential).groupBy(Credential.category),
    db()
      .select({ _id: VaultEvent._id, itemName: VaultEvent.itemName, action: VaultEvent.action, userName: VaultEvent.userName, ip: VaultEvent.ip, at: VaultEvent.at })
      .from(VaultEvent)
      .where(eq(VaultEvent.project, COMPANY_VAULT))
      .orderBy(desc(VaultEvent.at))
      .limit(20),
  ]);
  const total = counts.reduce((n, c) => n + c.n, 0);
  const configured = vaultConfigured();

  return (
    <PageBody>
      <PageHeader
        overline="Admin"
        title={
          <>
            Credential storage <span className="ml-1 text-base font-medium text-muted">{total}</span>
          </>
        }
        description="Usernames and passwords of the company's platforms, kept in one place."
        actions={configured ? <CredentialDialog /> : undefined}
      />

      {!configured ? (
        <Alert tone="warning" title="Encryption key missing.">
          Set VAULT_MASTER_KEY on the server to use credential storage.
        </Alert>
      ) : (
        <Alert tone="info" title="Only you can see this page.">
          Usernames, passwords and notes are encrypted (AES-256-GCM) with the server&apos;s VAULT_MASTER_KEY. Every reveal, copy and edit is logged below.
        </Alert>
      )}

      <Card>
        <div className="border-b border-line-soft px-4 py-3.5">
          <FilterBar>
            <SearchInput placeholder="Platform or URL" />
            <SelectFilter
              param="category"
              label="Category"
              allLabel="All categories"
              options={CREDENTIAL_CATEGORIES.map((c) => ({ value: c, label: `${CREDENTIAL_CATEGORY_LABELS[c]} (${counts.find((x) => x.category === c)?.n ?? 0})` }))}
            />
            <ClearFilters />
          </FilterBar>
        </div>
        <CredentialList
          filtered={Boolean(q || category)}
          rows={rows.map((r) => ({ id: r._id, platform: r.platform, category: r.category, url: r.url ?? undefined, valuesUpdatedAt: r.valuesUpdatedAt.toISOString() }))}
        />
      </Card>

      <Card>
        <CardHeader title="Access log" subtitle="Latest 20 events" action={<ShieldCheck className="size-4 text-muted" aria-hidden />} />
        <CardBody className="pb-3">
          {events.length === 0 ? (
            <p className="text-[13px] text-muted">Nothing has been stored or opened yet.</p>
          ) : (
            <ul className="flex flex-col">
              {events.map((e) => (
                <li key={e._id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t border-line-soft py-2 text-[13px] first:border-t-0 first:pt-0">
                  <span className="min-w-0 break-words text-ink">
                    <strong className="font-semibold">{CREDENTIAL_EVENT_LABELS[e.action] ?? e.action}</strong> · {e.itemName}
                  </span>
                  <span className="text-xs text-muted">
                    {e.userName} · {fmtDateTime(e.at)}
                    {e.ip ? ` · ${e.ip}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </PageBody>
  );
}
