"use client";

import { useState } from "react";
import { ActionForm, FormActions, SubmitButton } from "@/components/ui/form";
import { FileUpload } from "@/components/ui/file-upload";
import { addTaskAttachments } from "../actions";

/** Upload files to the task; they are attached when the form is submitted. */
export function AttachFiles({ taskId }: { taskId: string }) {
  const [version, setVersion] = useState(0);
  return (
    <ActionForm key={version} action={(input) => addTaskAttachments(taskId, input)} successMessage="Files attached" onSuccess={() => setVersion((v) => v + 1)} className="gap-3">
      <FileUpload context={{ entityType: "task", entityId: taskId }} label="Attach files" />
      <FormActions className="pt-0">
        <SubmitButton variant="secondary">Attach to task</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}
