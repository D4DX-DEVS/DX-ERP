"use client";

import { useState } from "react";
import { ActionForm, Field, FormActions, SubmitButton, type FormAction } from "@/components/ui/form";
import { Textarea } from "@/components/ui/input";
import { FileUpload } from "@/components/ui/file-upload";

/** Comment composer with optional attachments. Used on tasks, projects and QA issues. */
export function CommentBox({
  action,
  entityType,
  entityId,
  placeholder = "Write a comment…",
}: {
  action: FormAction;
  entityType: string;
  entityId: string;
  placeholder?: string;
}) {
  // Bumping the key remounts the form so the text and the attachment list both reset after posting.
  const [version, setVersion] = useState(0);
  return (
    <ActionForm key={version} action={action} successMessage="Comment added" onSuccess={() => setVersion((v) => v + 1)} className="gap-3">
      <Field name="text">
        <Textarea id="text" name="text" rows={3} placeholder={placeholder} aria-label="Comment" />
      </Field>
      <FileUpload context={{ entityType, entityId }} label="Attach files" />
      <FormActions className="pt-0">
        <SubmitButton>Comment</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}
