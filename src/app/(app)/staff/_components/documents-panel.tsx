import { FileText, Lock } from "lucide-react";
import type { DocumentCategory } from "@/lib/config-defaults";
import { fileSize } from "@/lib/format";
import { fmtDate } from "@/lib/time";
import { Alert } from "@/components/ui/page";
import { Card, CardHeader } from "@/components/ui/card";
import { Chip, Tag } from "@/components/ui/chip";
import { expiryText } from "../_lib/documents";
import type { DocView, DocumentsData } from "../_lib/documents-data";
import { DeleteDocumentButton, UploadDocumentButton, type CategoryOption } from "./document-dialogs";

export interface DocumentPerms {
  /** May upload new documents (self, staff.edit, interns.manage for interns). */
  upload: boolean;
  /** May delete / replace any document and upload restricted categories. */
  manage: boolean;
  /** The viewer is the person themself. */
  self: boolean;
  /** Restricted documents are listed. */
  seeConfidential: boolean;
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
  categories,
  data,
  perms,
}: {
  personId: string;
  /** Categories applicable to the person's type. */
  categories: DocumentCategory[];
  data: DocumentsData;
  perms: DocumentPerms;
}) {
  const uploadable = (perms.manage ? categories : categories.filter((c) => !c.confidential)).map(toOption);
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
          {!perms.manage && perms.self && " — please hand restricted documents to HR."}
        </Alert>
      )}
      {expiring > 0 && (
        <Alert tone="warning" title={`${expiring} ${expiring === 1 ? "document has" : "documents have"} expired or expire within 30 days.`}>
          Upload a new version to keep the record current.
        </Alert>
      )}
      <Card>
        <CardHeader
          title="Documents"
          subtitle={perms.seeConfidential ? "Restricted documents are marked and only listed for authorised people." : "Restricted documents are visible only to authorised people."}
          action={perms.upload && uploadable.length > 0 ? <UploadDocumentButton personId={personId} categories={uploadable} /> : undefined}
        />
        <div className="pb-2">
          {categories.length === 0 && <p className="px-5 pb-4 text-[13px] text-muted">No document categories apply to this person type. Configure them under Configuration.</p>}
          {categories.map((cat) => {
            const docs = byCategory.get(cat.key) ?? [];
            const hidden = cat.confidential && !perms.seeConfidential;
            return (
              <section key={cat.key} className="border-t border-line-soft first:border-t-0">
                <div className="flex flex-wrap items-center gap-2 px-5 pt-3 pb-1.5">
                  <h3 className="font-display text-sm font-semibold text-ink">{cat.label}</h3>
                  {cat.required && <Tag tone="gray">Required</Tag>}
                  {cat.confidential && (
                    <Tag tone="gray" className="gap-1 bg-navy text-white">
                      <Lock className="size-3" /> Restricted
                    </Tag>
                  )}
                  {missing.has(cat.key) && <Chip tone="amber" size="sm">Missing</Chip>}
                </div>
                {hidden ? (
                  <p className="px-5 pb-3 text-[13px] text-muted">{missing.has(cat.key) ? "Not on file." : "On file — visible to authorised HR staff only."}</p>
                ) : docs.length === 0 ? (
                  <p className="px-5 pb-3 text-[13px] text-muted">{cat.required ? "Not uploaded yet." : "Nothing uploaded."}</p>
                ) : (
                  <ul>
                    {docs.map((d) => (
                      <DocRow key={d.id} doc={d} personId={personId} perms={perms} categories={categories} />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
          {orphanDocs.length > 0 && (
            <section className="border-t border-line-soft">
              <h3 className="px-5 pt-3 pb-1.5 font-display text-sm font-semibold text-ink">Other categories</h3>
              <ul>
                {orphanDocs.map((d) => (
                  <DocRow key={d.id} doc={d} personId={personId} perms={perms} categories={categories} />
                ))}
              </ul>
            </section>
          )}
        </div>
      </Card>
    </div>
  );
}

function DocRow({ doc, personId, perms, categories }: { doc: DocView; personId: string; perms: DocumentPerms; categories: DocumentCategory[] }) {
  const canReplace = perms.upload && (perms.manage || (perms.self && !doc.confidential));
  const category = categories.find((c) => c.key === doc.category);
  return (
    <li className="flex flex-wrap items-start gap-3 px-5 py-2.5">
      <FileText className="mt-0.5 size-[18px] shrink-0 text-muted" aria-hidden />
      <div className="min-w-0 flex-1">
        <a href={`/api/files/${doc.id}`} target="_blank" rel="noopener noreferrer" className="block text-sm font-semibold break-words text-ink hover:text-brand-600">
          {doc.name}
        </a>
        <div className="text-xs text-muted">
          {fileSize(doc.size)} · v{doc.version} · uploaded {fmtDate(doc.uploadedAt)}
          {doc.uploadedByName ? ` by ${doc.uploadedByName}` : ""}
        </div>
        {doc.notes && <div className="mt-0.5 text-xs text-ink-2">{doc.notes}</div>}
        {doc.versions.length > 0 && (
          <details className="mt-1 text-xs text-muted">
            <summary className="cursor-pointer font-medium text-brand-600">Version history ({doc.versions.length} earlier)</summary>
            <ul className="mt-1 flex flex-col gap-0.5 pl-3">
              {doc.versions.map((v) => (
                <li key={v.id}>
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
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <ExpiryChip doc={doc} />
        {canReplace && category && (
          <UploadDocumentButton
            personId={personId}
            categories={[{ key: category.key, label: category.label, hasExpiry: category.hasExpiry, confidential: category.confidential }]}
            replace={{ id: doc.id, category: doc.category, name: doc.name }}
            label="New version"
            size="sm"
          />
        )}
        {perms.manage && <DeleteDocumentButton personId={personId} fileId={doc.id} name={doc.name} />}
      </div>
    </li>
  );
}
