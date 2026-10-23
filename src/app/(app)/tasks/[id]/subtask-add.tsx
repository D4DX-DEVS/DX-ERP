"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { addSubtask } from "../actions";

/** One-line quick add for subtasks (inherits project, assignees and due date from the parent). */
export function SubtaskAdd({ parentId }: { parentId: string }) {
  const [version, setVersion] = useState(0);
  return (
    <ActionForm key={version} action={(input) => addSubtask(parentId, input)} successMessage="Subtask added" onSuccess={() => setVersion((v) => v + 1)} className="flex-row items-start gap-2">
      <Input name="title" aria-label="New subtask title" placeholder="Add a subtask…" maxLength={300} autoComplete="off" className="flex-1" />
      <SubmitButton icon={<Plus className="size-4" aria-hidden />} variant="secondary">
        Add
      </SubmitButton>
    </ActionForm>
  );
}
