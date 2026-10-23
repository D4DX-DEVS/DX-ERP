"use client";

import { useState } from "react";
import { FileUpload } from "@/components/ui/file-upload";
import { ActionForm, FormActions, SubmitButton } from "@/components/ui/form";
import { addIssueAttachments } from "../actions";

/** Upload screenshots or logs to an existing issue. */
export function AttachFiles({ issueId }: { issueId: string }) {
  const [version, setVersion] = useState(0);
  return (
    <ActionForm key={version} action={(input) => addIssueAttachments(issueId, input)} successMessage="Files attached" onSuccess={() => setVersion((v) => v + 1)} className="gap-3">
      <FileUpload context={{ entityType: "issue", entityId: issueId }} label="Attach screenshots or logs" />
      <FormActions className="pt-0">
        <SubmitButton variant="secondary">Attach to issue</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}
