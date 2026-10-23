"use client";

import { KINDS } from "../_lib/kinds";
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FileUpload, type UploadedFile } from "@/components/ui/file-upload";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { PeoplePicker, type PickerOption } from "@/components/ui/people-picker";
import { saveResource } from "../actions";


const AUDIENCES = [
  { value: "intern", label: "Interns" },
  { value: "trainee", label: "Trainees" },
  { value: "employee", label: "Employees" },
  { value: "all", label: "Everyone" },
];

export interface ResourceFormValues {
  id: string;
  title: string;
  description?: string;
  kind: string;
  url?: string;
  attachments: UploadedFile[];
  audience: string[];
  department?: string;
  assignedTo: string[];
  dueDate?: string;
  estimatedHours?: number;
}

/** Create / edit dialog for a learning resource (interns.manage). */
export function ResourceFormButton({
  departments,
  people,
  initial,
}: {
  departments: { id: string; name: string }[];
  people: PickerOption[];
  initial?: ResourceFormValues;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="lg"
      title={initial ? "Edit learning resource" : "New learning resource"}
      description="Visible to the chosen audience and anyone you assign it to."
      trigger={
        initial ? (
          <Button variant="secondary" size="sm" icon={<Pencil className="size-3.5" />}>
            Edit
          </Button>
        ) : (
          <Button icon={<Plus className="size-4" />}>Add resource</Button>
        )
      }
    >
      <ActionForm action={saveResource} values={initial ? { id: initial.id } : undefined} successMessage="Resource saved" onSuccess={() => setOpen(false)}>
        <FormGrid>
          <Field label="Title" name="title" required className="sm:col-span-2">
            <Input id="title" name="title" maxLength={200} defaultValue={initial?.title ?? ""} />
          </Field>
          <Field label="Type" name="kind" required>
            <Select id="kind" name="kind" defaultValue={initial?.kind ?? "link"}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Link" name="url" hint="Web address of the video, course or document">
            <Input id="url" name="url" type="url" inputMode="url" placeholder="https://" defaultValue={initial?.url ?? ""} />
          </Field>
        </FormGrid>
        <Field label="Description" name="description">
          <Textarea id="description" name="description" rows={3} maxLength={5000} defaultValue={initial?.description ?? ""} />
        </Field>
        <Field label="Attachments" name="attachments">
          <FileUpload name="attachments" context={{ entityType: "learning" }} label="Attach files" initial={initial?.attachments} />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-[13px] font-semibold text-ink-2">Audience</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {AUDIENCES.map((a) => (
              <Checkbox key={a.value} name="audience[]" value={a.value} defaultChecked={initial ? initial.audience.includes(a.value) : a.value === "intern" || a.value === "trainee"} label={a.label} />
            ))}
          </div>
          <FieldError name="audience" />
        </fieldset>
        <FormGrid>
          <Field label="Department" name="department" hint="Optional — limit the audience to one department">
            <Select id="department" name="department" defaultValue={initial?.department ?? ""}>
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due date" name="dueDate">
            <Input id="dueDate" name="dueDate" type="date" defaultValue={initial?.dueDate ?? ""} />
          </Field>
          <Field label="Estimated hours" name="estimatedHours">
            <Input id="estimatedHours" name="estimatedHours" inputMode="decimal" defaultValue={initial?.estimatedHours !== undefined ? String(initial.estimatedHours) : ""} />
          </Field>
        </FormGrid>
        <Field label="Assign to specific people" name="assignedTo" hint="Assigned people see it regardless of the audience, and are notified">
          <PeoplePicker name="assignedTo" multiple options={people} defaultValue={initial?.assignedTo} placeholder="Select people" />
        </Field>
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton>{initial ? "Save changes" : "Create resource"}</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}

function FieldError({ name }: { name: string }) {
  // Reuses Field's error rendering without a visible label.
  return <Field name={name}>{null}</Field>;
}
