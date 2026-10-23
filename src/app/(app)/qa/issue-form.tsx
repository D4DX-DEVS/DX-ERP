"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { FileUpload } from "@/components/ui/file-upload";
import { ActionForm, Field, FormActions, FormGrid, FormSection, SubmitButton } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PeoplePicker, type PickerOption } from "@/components/ui/people-picker";
import { PRIORITY_OPTIONS, SEVERITY_OPTIONS } from "../tasks/_components/options";
import { createIssue } from "./actions";

export interface IssueProjectOption {
  id: string;
  label: string;
}

export interface IssueTaskOption {
  id: string;
  label: string;
  project: string;
}

/** "Report issue" form. The assignee field is shown only to people who may assign. */
export function IssueForm({
  projects,
  tasks,
  people,
  initial,
}: {
  projects: IssueProjectOption[];
  tasks: IssueTaskOption[];
  /** Undefined when the user can't assign issues. */
  people?: PickerOption[];
  initial: { project: string; task: string };
}) {
  const router = useRouter();
  const [project, setProject] = useState(initial.project);
  const projectTasks = tasks.filter((t) => t.project === project);
  return (
    <ActionForm action={createIssue} successMessage="Issue reported" onSuccess={(d) => router.push(`/qa/${(d as { id: string }).id}`)} className="gap-6">
      <FormSection title="What went wrong">
        <FormGrid>
          <Field label="Project" name="project" required>
            <Select id="project" name="project" value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">Select a project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Related task" name="task">
            <Select key={project} id="task" name="task" defaultValue={projectTasks.some((t) => t.id === initial.task) ? initial.task : ""} disabled={!project}>
              <option value="">{project ? (projectTasks.length ? "No related task" : "No tasks in this project") : "Choose a project first"}</option>
              {projectTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Title" name="title" required className="sm:col-span-2">
            <Input id="title" name="title" maxLength={300} autoComplete="off" placeholder="Short summary of the defect" />
          </Field>
          <Field label="Description" name="description" className="sm:col-span-2">
            <Textarea id="description" name="description" rows={4} placeholder="What happened and what did you expect?" />
          </Field>
          <Field label="Steps to reproduce" name="stepsToReproduce" className="sm:col-span-2">
            <Textarea id="stepsToReproduce" name="stepsToReproduce" rows={4} placeholder={"1. Open …\n2. Click …\n3. See the error"} />
          </Field>
          <Field label="Environment" name="environment" hint="Browser, device, build or URL" className="sm:col-span-2">
            <Input id="environment" name="environment" maxLength={500} autoComplete="off" placeholder="e.g. Chrome 130 on Windows 11, staging" />
          </Field>
        </FormGrid>
      </FormSection>

      <FormSection title="Triage">
        <FormGrid>
          <Field label="Severity" name="severity" required>
            <Select id="severity" name="severity" defaultValue="minor">
              {SEVERITY_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority" name="priority" required>
            <Select id="priority" name="priority" defaultValue="medium">
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          {people && (
            <Field label="Assign to" name="assignee" hint="Assigning moves the issue to Assigned">
              <PeoplePicker name="assignee" options={people} placeholder="Select developer" />
            </Field>
          )}
          <Field label="Target resolution date" name="targetDate">
            <Input id="targetDate" name="targetDate" type="date" />
          </Field>
        </FormGrid>
      </FormSection>

      <FormSection title="Screenshots and files">
        <FileUpload context={{ entityType: "issue" }} label="Attach screenshots or logs" />
      </FormSection>

      <FormActions>
        <ButtonLink href="/qa" variant="secondary">
          Cancel
        </ButtonLink>
        <SubmitButton>Report issue</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}
