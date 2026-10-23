"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Input, Select } from "@/components/ui/input";
import { PeoplePicker, type PickerOption } from "@/components/ui/people-picker";
import { PRIORITY_OPTIONS, SEVERITY_OPTIONS } from "../../tasks/_components/options";
import { triageIssue } from "../actions";

/** Assignment, severity, priority and target date (QA managers and the project manager). */
export function TriageDialog({ issueId, initial, people }: { issueId: string; initial: { severity: string; priority: string; targetDate: string; assignee: string }; people: PickerOption[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="md"
      title="Assign and triage"
      trigger={
        <Button variant="secondary" icon={<SlidersHorizontal className="size-4" aria-hidden />} className="w-full">
          Assign / triage
        </Button>
      }
    >
      <ActionForm action={(input) => triageIssue(issueId, input)} successMessage="Issue updated" onSuccess={() => setOpen(false)}>
        <FormGrid>
          <Field label="Assignee" name="assignee" className="sm:col-span-2" hint="Assigning an open issue moves it to Assigned">
            <PeoplePicker name="assignee" options={people} defaultValue={initial.assignee} placeholder="Select developer" />
          </Field>
          <Field label="Severity" name="severity" required>
            <Select id="severity" name="severity" defaultValue={initial.severity}>
              {SEVERITY_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority" name="priority" required>
            <Select id="priority" name="priority" defaultValue={initial.priority}>
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Target resolution date" name="targetDate">
            <Input id="targetDate" name="targetDate" type="date" defaultValue={initial.targetDate} />
          </Field>
        </FormGrid>
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton>Save</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}
