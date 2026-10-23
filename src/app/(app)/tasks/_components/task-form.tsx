"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { ActionForm, Field, FormActions, FormGrid, FormSection, SubmitButton } from "@/components/ui/form";
import { Input, Select, Switch, Textarea } from "@/components/ui/input";
import { ButtonLink } from "@/components/ui/button";
import { PeoplePicker, type PickerOption } from "@/components/ui/people-picker";
import { PRIORITY_OPTIONS } from "./options";
import { createTask, updateTask } from "../actions";

export interface TaskFormProject {
  id: string;
  label: string;
  milestones: { id: string; title: string }[];
}

export interface TaskFormDependency {
  id: string;
  label: string;
  project: string;
  /** Not itself a subtask, so it may serve as a parent. */
  topLevel: boolean;
}

export interface TaskFormInitial {
  id?: string;
  project?: string;
  milestone?: string;
  parent?: string;
  parentLabel?: string;
  title: string;
  description: string;
  assignees: string[];
  reviewer?: string;
  priority: string;
  startDate: string;
  dueDate: string;
  estimateHours: string;
  dependencies: string[];
  sharedWith: string[];
  isLearning: boolean;
}

function DependencyPicker({ options, initial }: { options: TaskFormDependency[]; initial: string[] }) {
  const [selected, setSelected] = useState<string[]>(initial);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter((o) => selected.includes(o.id) || !q || o.label.toLowerCase().includes(q)).slice(0, 80);
  }, [options, query, selected]);
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-line-strong bg-white p-2">
      {selected.map((id) => (
        <input key={id} type="hidden" name="dependencies[]" value={id} />
      ))}
      {options.length === 0 ? (
        <p className="px-1 py-2 text-[13px] text-muted">No other tasks in this project yet.</p>
      ) : (
        <>
          <label className="flex h-9 items-center gap-2 rounded-lg bg-field px-2.5 text-muted">
            <Search className="size-4" aria-hidden />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tasks" aria-label="Search tasks" className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none" />
          </label>
          <ul className="scrollbar-thin max-h-44 overflow-y-auto">
            {shown.length === 0 && <li className="px-2 py-3 text-center text-[13px] text-muted">No matches</li>}
            {shown.map((o) => (
              <li key={o.id}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] hover:bg-field">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand-600"
                    checked={selected.includes(o.id)}
                    onChange={() => setSelected((cur) => (cur.includes(o.id) ? cur.filter((x) => x !== o.id) : [...cur, o.id]))}
                  />
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Create / edit form for a task (also used for subtasks via `initial.parent`). */
export function TaskForm({
  projects,
  dependencies,
  people,
  initial,
  lockProject,
  canPickNoProject,
}: {
  projects: TaskFormProject[];
  dependencies: TaskFormDependency[];
  people: PickerOption[];
  initial: TaskFormInitial;
  /** Edit mode / subtasks: the project can't change. */
  lockProject: boolean;
  /** `tasks.manage` may create tasks without a project. */
  canPickNoProject: boolean;
}) {
  const router = useRouter();
  const editing = Boolean(initial.id);
  const [projectId, setProjectId] = useState(initial.project ?? "");
  const project = projects.find((p) => p.id === projectId);
  const deps = useMemo(() => dependencies.filter((d) => d.project === projectId && d.id !== initial.id), [dependencies, projectId, initial.id]);
  const parents = deps.filter((d) => d.topLevel);

  const action = (input: Record<string, unknown>) => (editing ? updateTask(initial.id!, input) : createTask(input));

  return (
    <ActionForm
      action={action}
      values={lockProject ? { project: initial.project ?? "", ...(initial.parent ? { parent: initial.parent } : {}) } : undefined}
      successMessage={editing ? "Task updated" : "Task created"}
      onSuccess={(d) => router.push(`/tasks/${(d as { id: string }).id}`)}
      className="gap-6"
    >
      <FormSection title="Task">
        <FormGrid>
          <Field label="Title" name="title" required className="sm:col-span-2">
            <Input id="title" name="title" defaultValue={initial.title} maxLength={300} autoComplete="off" />
          </Field>
          <Field label="Project" name="project" required={!canPickNoProject} hint={initial.parentLabel ? `Subtask of ${initial.parentLabel}` : lockProject ? "The project can't be changed" : undefined}>
            {lockProject ? (
              <Input id="project" value={project?.label ?? "No project"} disabled readOnly />
            ) : (
              <Select id="project" name="project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">{canPickNoProject ? "No project" : "Select a project"}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Milestone" name="milestone">
            <Select key={projectId} id="milestone" name="milestone" defaultValue={initial.milestone ?? ""} disabled={!project || project.milestones.length === 0}>
              <option value="">{project && project.milestones.length === 0 ? "No milestones yet" : "No milestone"}</option>
              {project?.milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </Select>
          </Field>
          {!lockProject && (
            <Field label="Parent task" name="parent" hint="Optional — makes this task a subtask of the one you choose" className="sm:col-span-2">
              <Select key={projectId} id="parent" name="parent" defaultValue="" disabled={parents.length === 0}>
                <option value="">{parents.length === 0 ? "No tasks to attach to" : "No parent (top-level task)"}</option>
                {parents.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Description" name="description" className="sm:col-span-2">
            <Textarea id="description" name="description" rows={5} defaultValue={initial.description} placeholder="What needs to be done, acceptance criteria, links…" />
          </Field>
        </FormGrid>
      </FormSection>

      <FormSection title="People">
        <FormGrid>
          <Field label="Assignees" name="assignees" hint="Employees, trainees and interns who work on this task">
            <PeoplePicker name="assignees" options={people} multiple defaultValue={initial.assignees} placeholder="Select assignees" />
          </Field>
          <Field label="Reviewer" name="reviewer" hint="Approves submitted work. Leave empty if no approval is needed.">
            <PeoplePicker name="reviewer" options={people} defaultValue={initial.reviewer} placeholder="Select reviewer" />
          </Field>
          <Field label="Shared with" name="sharedWith" hint="Can see the task without being assigned (e.g. interns observing)" className="sm:col-span-2">
            <PeoplePicker name="sharedWith" options={people} multiple defaultValue={initial.sharedWith} placeholder="Select people" />
          </Field>
        </FormGrid>
      </FormSection>

      <FormSection title="Planning">
        <FormGrid cols={4}>
          <Field label="Priority" name="priority" required>
            <Select id="priority" name="priority" defaultValue={initial.priority}>
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Start date" name="startDate">
            <Input id="startDate" name="startDate" type="date" defaultValue={initial.startDate} />
          </Field>
          <Field label="Due date" name="dueDate">
            <Input id="dueDate" name="dueDate" type="date" defaultValue={initial.dueDate} />
          </Field>
          <Field label="Estimate (hours)" name="estimateHours">
            <Input id="estimateHours" name="estimateHours" type="number" inputMode="decimal" min={0} step="0.5" defaultValue={initial.estimateHours} />
          </Field>
        </FormGrid>
        <Field label="Depends on" name="dependencies" hint="This task is shown as blocked until these tasks are done">
          <DependencyPicker key={projectId} options={deps} initial={projectId === (initial.project ?? "") ? initial.dependencies : []} />
        </Field>
        <Switch name="isLearning" label="Learning task" description="Marks the task as part of an intern / trainee learning plan" defaultChecked={initial.isLearning} />
      </FormSection>

      <FormActions>
        <ButtonLink href={editing ? `/tasks/${initial.id}` : "/tasks"} variant="secondary">
          Cancel
        </ButtonLink>
        <SubmitButton>{editing ? "Save changes" : "Create task"}</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}
