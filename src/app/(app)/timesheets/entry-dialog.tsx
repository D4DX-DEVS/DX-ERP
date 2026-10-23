"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { ActionButton } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Input, Select, Switch, Textarea } from "@/components/ui/input";
import { deleteEntry, saveEntry } from "./actions";

export interface EntryInitial {
  id?: string;
  date: string;
  project: string;
  task: string;
  duration: string;
  description: string;
  billable: boolean;
}

export interface ProjectOption {
  id: string;
  label: string;
}

export interface TaskOption {
  id: string;
  label: string;
  project: string;
}

interface FormProps {
  initial: EntryInitial;
  projects: ProjectOption[];
  tasks: TaskOption[];
  minDate: string;
  maxDate: string;
  onDone: () => void;
}

function EntryForm({ initial, projects, tasks, minDate, maxDate, onDone }: FormProps) {
  const [project, setProject] = useState(initial.project);
  const [billable, setBillable] = useState(initial.billable);
  const [touched, setTouched] = useState(Boolean(initial.id));
  const projectTasks = tasks.filter((t) => t.project === project);
  return (
    <ActionForm action={(input) => saveEntry(initial.id, input)} successMessage={initial.id ? "Entry updated" : "Time logged"} onSuccess={onDone}>
      <FormGrid>
        <Field label="Date" name="date" required>
          <Input id="date" name="date" type="date" min={minDate} max={maxDate} defaultValue={initial.date} />
        </Field>
        <Field label="Duration" name="duration" required hint="Hours (1.5) or h:mm (1:30)">
          <Input id="duration" name="duration" inputMode="text" autoComplete="off" placeholder="1.5" defaultValue={initial.duration} />
        </Field>
        <Field label="Project" name="project">
          <Select
            id="project"
            name="project"
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
              if (!touched) setBillable(Boolean(e.target.value));
            }}
          >
            <option value="">No project (internal)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Task" name="task">
          <Select key={project} id="task" name="task" defaultValue={projectTasks.some((t) => t.id === initial.task) ? initial.task : ""}>
            <option value="">{projectTasks.length === 0 ? "No tasks available" : "No specific task"}</option>
            {projectTasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="What did you work on?" name="description" required className="sm:col-span-2">
          <Textarea id="description" name="description" rows={3} defaultValue={initial.description} placeholder="Short description of the work" maxLength={2000} />
        </Field>
        <div className="sm:col-span-2">
          <Switch
            name="billable"
            label="Billable"
            description="Counts towards client billing"
            checked={billable}
            onChange={(e) => {
              setTouched(true);
              setBillable(e.target.checked);
            }}
          />
        </div>
      </FormGrid>
      <FormActions>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton>{initial.id ? "Save entry" : "Log time"}</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}

/** "Add time" button + dialog. `defaultOpen` lets `?task=` links open the form straight away. */
export function AddEntry({ defaultOpen = false, ...props }: Omit<FormProps, "onDone"> & { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Log time"
      trigger={
        <Button icon={<Plus className="size-4" aria-hidden />}>Log time</Button>
      }
    >
      <EntryForm {...props} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

/** Edit and delete controls for a draft or rejected entry. */
export function EntryActions({ entryId, ...props }: Omit<FormProps, "onDone"> & { entryId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Edit entry"
        trigger={
          <Button variant="ghost" size="icon-sm" aria-label="Edit entry">
            <Pencil className="size-4" aria-hidden />
          </Button>
        }
      >
        <EntryForm {...props} onDone={() => setOpen(false)} />
      </Dialog>
      <ActionButton action={() => deleteEntry(entryId)} variant="ghost" size="icon-sm" aria-label="Delete entry" confirmTone="danger" confirmTitle="Delete time entry" confirmLabel="Delete" confirm="Delete this time entry?" successMessage="Entry deleted">
        <Trash2 className="size-4 text-danger" aria-hidden />
      </ActionButton>
    </span>
  );
}
