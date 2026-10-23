"use client";

import { useState } from "react";
import { FileText, Trash2 } from "lucide-react";
import { ActionButton } from "@/components/ui/actions";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FileUpload } from "@/components/ui/file-upload";
import { ActionForm, FormActions, SubmitButton } from "@/components/ui/form";
import { fileSize } from "@/lib/format";
import { addProjectFiles, removeProjectFile } from "../actions";

export interface ProjectFileView {
  refId: string;
  file: string;
  name: string;
  size?: number;
  by: string;
  when: string;
  canRemove: boolean;
}

/** Project documents: download, upload and remove. */
export function FilesPanel({ projectId, files }: { projectId: string; files: ProjectFileView[] }) {
  const [version, setVersion] = useState(0);
  return (
    <Card>
      <CardHeader title="Files" subtitle="Specifications, designs, contracts and delivery documents" />
      <CardBody className="flex flex-col gap-4">
        {files.length === 0 && <p className="text-[13px] text-muted">No files attached yet.</p>}
        <ul className="flex flex-col gap-1.5">
          {files.map((f) => (
            <li key={f.refId} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px]">
              <FileText className="size-4 shrink-0 text-brand-600" aria-hidden />
              <a href={`/api/files/${f.file}`} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 hover:text-brand-600">
                <span className="block truncate font-medium text-ink">{f.name}</span>
                <span className="block truncate text-xs text-muted">
                  {f.by} · {f.when}
                  {f.size ? ` · ${fileSize(f.size)}` : ""}
                </span>
              </a>
              {f.canRemove && (
                <ActionButton action={() => removeProjectFile(projectId, f.refId)} variant="ghost" size="icon-sm" aria-label={`Remove ${f.name}`} confirmTone="danger" confirmTitle="Remove file" confirmLabel="Remove" confirm={`Remove ${f.name} from the project?`} successMessage="File removed">
                  <Trash2 className="size-4 text-danger" aria-hidden />
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
        <ActionForm key={version} action={(input) => addProjectFiles(projectId, input)} successMessage="Files attached" onSuccess={() => setVersion((v) => v + 1)} className="gap-3 border-t border-line-soft pt-4">
          <FileUpload context={{ entityType: "project", entityId: projectId }} label="Upload files" />
          <FormActions className="pt-0">
            <SubmitButton variant="secondary">Attach to project</SubmitButton>
          </FormActions>
        </ActionForm>
      </CardBody>
    </Card>
  );
}
