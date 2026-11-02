import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import type { DocumentCategory } from "@/lib/config-defaults";
import { fmtDate } from "@/lib/time";
import { Alert } from "@/components/ui/page";
import { Card, CardHeader } from "@/components/ui/card";
import { Chip, Tag } from "@/components/ui/chip";
import { expiryText } from "../_lib/documents";
import type { DocView, DocumentsData } from "../_lib/documents-data";
import { DeleteDocumentButton, DocumentAccessSwitch, UploadDocumentButton, type CategoryOption } from "./document-dialogs";
import { BANK_CATEGORY } from "../_lib/bank";
import { EDUCATION_CATEGORY } from "../_lib/education";
import { FileTile, MissingTile } from "./file-tile";

export interface DocumentPerms {
  /** May upload new documents (self, staff.edit, interns.manage for interns). */
  upload: boolean;
  /** May delete / replace any document and upload restricted categories. */
  manage: boolean;
  /** The viewer is the person themself. */
  self: boolean;
  /** Restricted documents are listed. */
  seeConfidential: boolean;
  /** The person may upload restricted categories themself (HR opened them: User.documentUploadOpen). */
  restrictedUpload?: boolean;
}

const toOption = (c: DocumentCategory): CategoryOption => ({ key: c.key, label: c.label, hasExpiry: c.hasExpiry, confidential: c.confidential });

function ExpiryChip({ doc }: { doc: DocView }) {
  if (doc.expiry.state === "none") return null;
  if (doc.expiry.state === "expired") return <Chip tone="red" size="sm">{expiryText(doc.expiry)}</Chip>;
  if (doc.expiry.state === "expiring") return <Chip tone="amber" size="sm">{expiryText(doc.expiry)}</Chip>;
  return <span className="text-xs text-muted">Valid until {fmtDate(doc.expiryDate)}</span>;
}

/** Documents grouped by category with expiry flags, version history and a missing-documents summary. */
export function DocumentsPanel({
  personId,
  categories: applicable,
  data,
  perms,
  access,
}: {
  personId: string;
  /** Categories applicable to the person's type. */
  categories: DocumentCategory[];
  data: DocumentsData;
  perms: DocumentPerms;
  /** Shown to HR on someone else's record: the switch that opens restricted categories to the person. */
  access?: { name: string; open: boolean };
}) {
  // Educational certificates and bank proofs have their own structured sections (EducationPanel, BankPanel); the old flat
  // categories only list legacy files.
  const structured = [EDUCATION_CATEGORY, BANK_CATEGORY];
  const legacy = new Set(data.docs.map((d) => d.category).filter((c) => structured.includes(c)));
  const categories = applicable.filter((c) => !structured.includes(c.key) || legacy.has(c.key));
  const uploadable = (perms.manage || perms.restrictedUpload ? categories : categories.filter((c) => !c.confidential)).filter((c) => !structured.includes(c.key)).map(toOption);
  const missing = new Set(data.missing.map((m) => m.key));
  const byCategory = new Map<string, DocView[]>();
  for (const d of data.docs) byCategory.set(d.category, [...(byCategory.get(d.category) ?? []), d]);
  const knownKeys = new Set(categories.map((c) => c.key));
  const orphanDocs = data.docs.filter((d) => !knownKeys.has(d.category));
  const expiring = data.docs.filter((d) => d.expiry.state === "expired" || d.expiry.state === "expiring").length;

  return (
    <div className="flex flex-col gap-4">
      {data.missing.length > 0 && (
        <Alert tone="warning" title={`${data.missing.length} required ${data.missing.length === 1 ? "document is" : "documents are"} missing:`}>
          {data.missing.map((m) => m.label).join(" · ")}
          {!perms.manage && perms.self && !perms.restrictedUpload && " — please hand restricted documents to HR."}
        </Alert>
      )}
      {expiring > 0 && (
        <Alert tone="warning" title={`${expiring} ${expiring === 1 ? "document has" : "documents have"} expired or expire within 30 days.`}>
          Upload a new version to keep the record current.
        </Alert>
      )}
      {access && (
        <Card className="p-4 sm:p-5">
          <DocumentAccessSwitch personId={personId} name={access.name} open={access.open} />
        </Card>
      )}
      <Card className="@container">
        <CardHeader
          title="Documents"
          subtitle={perms.seeConfidential ? "Restricted documents are marked and only listed for authorised people." : "Restricted documents are visible only to authorised people."}
          action={perms.upload && uploadable.length > 0 ? <UploadDocumentButton personId={personId} categories={uploadable} /> : undefined}
        />
        {categories.length === 0 ? (
          <p className="px-5 pb-4 text-[13px] text-muted">No document categories apply to this person type. Configure them under Configuration.</p>
        ) : (
          <div className="grid gap-3 px-4 pb-4 sm:px-5 sm:pb-5 @3xl:grid-cols-2">
            {categories.map((cat) => {
              const docs = byCategory.get(cat.key) ?? [];
              const hidden = cat.confidential && !perms.seeConfidential;
              const option = uploadable.find((o) => o.key === cat.key);
              return (
                <CategoryBox key={cat.key} category={cat} docs={hidden ? [] : docs} missing={missing.has(cat.key)}>
                  {hidden ? (
                    <p className="flex items-center gap-2 rounded-xl bg-field px-3 py-3 text-[13px] text-muted">
                      <Lock className="size-4 shrink-0 text-subtle" aria-hidden />
                      {missing.has(cat.key) ? "Not on file." : "On file — visible to authorised HR staff only."}
                    </p>
                  ) : docs.length === 0 ? (
                    <MissingTile
                      title={cat.required ? "Not uploaded yet" : "Nothing uploaded"}
                      hint={cat.required ? "Required for the record" : "Optional"}
                      tone={cat.required ? "warning" : "muted"}
                      action={perms.upload && option ? <UploadDocumentButton personId={personId} categories={[option]} label="Upload" size="sm" /> : undefined}
                    />
                  ) : (
                    docs.map((d) => <DocTile key={d.id} doc={d} personId={personId} perms={perms} categories={categories} />)
                  )}
                </CategoryBox>
              );
            })}
            {orphanDocs.length > 0 && (
              <CategoryBox category={{ label: "Other categories" }} docs={orphanDocs}>
                {orphanDocs.map((d) => (
                  <DocTile key={d.id} doc={d} personId={personId} perms={perms} categories={categories} showCategory />
                ))}
              </CategoryBox>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

/** One document category: its name, flags and a status chip over its files (or the slot to upload one). */
function CategoryBox({
  category: cat,
  docs,
  missing,
  children,
}: {
  category: Pick<DocumentCategory, "label"> & Partial<Pick<DocumentCategory, "required" | "confidential">>;
  docs: DocView[];
  missing?: boolean;
  children: ReactNode;
}) {
  const expired = docs.some((d) => d.expiry.state === "expired");
  const expiring = docs.some((d) => d.expiry.state === "expiring");
  const status = missing ? (
    <Chip tone="amber" size="sm">
      Missing
    </Chip>
  ) : expired ? (
    <Chip tone="red" size="sm">
      Expired
    </Chip>
  ) : expiring ? (
    <Chip tone="amber" size="sm">
      Expiring
    </Chip>
  ) : docs.length > 0 ? (
    <Chip tone="green" size="sm">
      {docs.length === 1 ? "Uploaded" : `${docs.length} files`}
    </Chip>
  ) : null;
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line">
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-3.5 py-2.5">
        <h3 className="min-w-0 font-display text-[13px] font-semibold break-words text-ink">{cat.label}</h3>
        {cat.required && <Tag tone="gray">Required</Tag>}
        {cat.confidential && (
          <Tag tone="gray" className="gap-1 bg-navy text-white">
            <Lock className="size-3" /> Restricted
          </Tag>
        )}
        {status && <span className="ml-auto">{status}</span>}
      </div>
      <div className="flex flex-1 flex-col gap-2 bg-field/60 p-2.5">{children}</div>
    </section>
  );
}

function DocTile({ doc, personId, perms, categories, showCategory }: { doc: DocView; personId: string; perms: DocumentPerms; categories: DocumentCategory[]; showCategory?: boolean }) {
  const canReplace = perms.upload && (perms.manage || (perms.self && (!doc.confidential || Boolean(perms.restrictedUpload))));
  const category = categories.find((c) => c.key === doc.category);
  return (
    <FileTile
      title={showCategory ? doc.categoryLabel : undefined}
      file={doc.id}
      name={doc.name}
      size={doc.size}
      meta={`v${doc.version}`}
      uploadedAt={doc.uploadedAt}
      uploadedByName={doc.uploadedByName}
      note={doc.notes}
      actions={
        <>
          {canReplace && category && (
            <UploadDocumentButton
              personId={personId}
              categories={[toOption(category)]}
              replace={{ id: doc.id, category: doc.category, name: doc.name }}
              label="Upload new version"
              iconOnly
            />
          )}
          {perms.manage && <DeleteDocumentButton personId={personId} fileId={doc.id} name={doc.name} />}
        </>
      }
    >
      {doc.expiry.state !== "none" && (
        <div className="mt-1.5">
          <ExpiryChip doc={doc} />
        </div>
      )}
      {doc.versions.length > 0 && (
        <details className="mt-1.5 text-xs text-muted">
          <summary className="cursor-pointer font-medium text-brand-600">Version history ({doc.versions.length} earlier)</summary>
          <ul className="mt-1 flex flex-col gap-0.5 border-l-2 border-line pl-3">
            {doc.versions.map((v) => (
              <li key={v.id} className="break-words">
                <a href={`/api/files/${v.id}`} target="_blank" rel="noopener noreferrer" className="hover:text-brand-600">
                  v{v.version} · {v.name}
                </a>{" "}
                · {fmtDate(v.uploadedAt)}
                {v.uploadedByName ? ` · ${v.uploadedByName}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </FileTile>
  );
}
