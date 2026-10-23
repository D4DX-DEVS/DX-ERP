"use client";

import { useState } from "react";
import { FileText, Trash2 } from "lucide-react";
import { ActionButton } from "@/components/ui/actions";
import { ActionForm, FormActions, SubmitButton } from "@/components/ui/form";
import { FileUpload } from "@/components/ui/file-upload";
import { fileSize } from "@/lib/format";
import type { ActionResult } from "@/lib/action-result";

export interface AttachmentRow {
  refId: string;
  file: string;
  name: string;
  size?: number;
}

/**
 * Attachments for a lead, client or contract: access-checked downloads plus upload / remove. `add` and `remove`
 * are server actions bound by the page (e.g. `addAttachments.bind(null, "lead", id)`).
 */
export function AttachmentsPanel({
  entityType,
  entityId,
  files,
  canManage,
  confidential,
  add,
  remove,
}: {
  entityType: "lead" | "client" | "contract";
  entityId: string;
  files: AttachmentRow[];
  canManage: boolean;
  confidential: boolean;
  add: (input: Record<string, unknown>) => Promise<ActionResult<null>>;
  remove: (fileRefId: string) => Promise<ActionResult<null>>;
}) {
  const [nonce, setNonce] = useState(0);
  return (
    <div className="flex flex-col gap-3">
      {files.length === 0 ? (
        <p className="text-[13px] text-muted">No attachments yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {files.map((f) => (
            <li key={f.refId} className="flex items-center gap-1 rounded-lg border border-line pr-1 hover:border-brand-200">
              <a href={`/api/files/${f.file}`} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-[13px] hover:text-brand-600">
                <FileText className="size-4 shrink-0 text-brand-600" aria-hidden />
                <span className="min-w-0 flex-1 font-medium break-words text-ink">{f.name}</span>
                {f.size ? <span className="text-xs text-muted">{fileSize(f.size)}</span> : null}
              </a>
              {canManage && (
                <ActionButton
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${f.name}`}
                  confirmTone="danger" confirmTitle="Remove attachment" confirmLabel="Remove" confirm={`Remove ${f.name}? The file will no longer be available.`}
                  action={() => remove(f.refId)}
                  successMessage="Attachment removed"
                >
                  <Trash2 className="size-4" aria-hidden />
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <ActionForm action={add} successMessage="Files attached" onSuccess={() => setNonce((n) => n + 1)} className="gap-2">
          <FileUpload key={nonce} context={{ entityType, entityId, confidential }} />
          <FormActions className="pt-0">
            <SubmitButton size="sm" variant="secondary">
              Attach files
            </SubmitButton>
          </FormActions>
        </ActionForm>
      )}
    </div>
  );
}
