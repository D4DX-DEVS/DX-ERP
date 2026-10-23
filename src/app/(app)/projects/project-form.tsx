"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { ActionForm, Field, FormActions, FormGrid, FormSection, SubmitButton } from "@/components/ui/form";
import { Input, Select, Switch, Textarea } from "@/components/ui/input";
import { PeoplePicker, type PickerOption } from "@/components/ui/people-picker";
import { PRIORITY_OPTIONS } from "../tasks/_components/options";
import { createProject, updateProject } from "./actions";

export interface TeamRow {
  user: string;
  role: string;
  allocation: string;
}

export interface ProjectFormInitial {
  id?: string;
  title: string;
  internal: boolean;
  client: string;
  description: string;
  scope: string;
  deliverables: string;
  manager: string;
  team: TeamRow[];
  startDate: string;
  targetDate: string;
  budget: string;
  estimatedHours: string;
  priority: string;
  status: string;
  proposal: string;
  contract: string;
}

export interface Reference {
  id: string;
  label: string;
  client: string;
}

/** Team members with a role and an allocation percentage. Posts the rows as one JSON field. */
export function TeamEditor({ people, initial }: { people: PickerOption[]; initial: TeamRow[] }) {
  const [rows, setRows] = useState<(TeamRow & { key: number })[]>(() => initial.map((r, i) => ({ ...r, key: i })));
  const [nextKey, setNextKey] = useState(initial.length);
  const patch = (key: number, p: Partial<TeamRow>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const payload = JSON.stringify(rows.filter((r) => r.user).map((r) => ({ user: r.user, role: r.role, allocation: r.allocation === "" ? "100" : r.allocation })));
  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="team" value={payload} />
      {rows.length === 0 && <p className="text-[13px] text-muted">No team members yet.</p>}
      {rows.map((r, i) => (
        <div key={r.key} className="grid items-end gap-2 rounded-xl border border-line-soft p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_96px_36px]">
          <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-ink-2">
            Person
            <PeoplePicker name={`team-user-${r.key}`} options={people} defaultValue={r.user} placeholder="Select person" onChange={(v) => patch(r.key, { user: v[0] ?? "" })} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
            Role
            <Input value={r.role} maxLength={100} placeholder="e.g. Developer" onChange={(e) => patch(r.key, { role: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
            Allocation %
            <Input type="number" inputMode="numeric" min={0} max={100} value={r.allocation} onChange={(e) => patch(r.key, { allocation: e.target.value })} />
          </label>
          <Button variant="ghost" size="icon" aria-label={`Remove team member ${i + 1}`} onClick={() => setRows((cur) => cur.filter((x) => x.key !== r.key))}>
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      ))}
      <div>
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus className="size-4" aria-hidden />}
          onClick={() => {
            setRows((cur) => [...cur, { key: nextKey, user: "", role: "", allocation: "100" }]);
            setNextKey((k) => k + 1);
          }}
        >
          Add team member
        </Button>
      </div>
    </div>
  );
}

/** Create / edit project form. */
export function ProjectForm({
  initial,
  clients,
  proposals,
  contracts,
  statuses,
  people,
  showBudget,
}: {
  initial: ProjectFormInitial;
  clients: { id: string; name: string }[];
  /** Undefined when the user can't view proposals / contracts. */
  proposals?: Reference[];
  contracts?: Reference[];
  statuses: { key: string; label: string }[];
  people: PickerOption[];
  showBudget: boolean;
}) {
  const router = useRouter();
  const editing = Boolean(initial.id);
  const [internal, setInternal] = useState(initial.internal);
  const [clientId, setClientId] = useState(initial.client);
  const action = (input: Record<string, unknown>) => (editing ? updateProject(initial.id!, input) : createProject(input));
  const forClient = (list: Reference[]) => list.filter((r) => !clientId || r.client === clientId);

  return (
    <ActionForm
      action={action}
      successMessage={editing ? "Project saved" : "Project created"}
      onSuccess={(d) => router.push(`/projects/${(d as { id: string }).id}`)}
      className="gap-6"
    >
      <FormSection title="Overview">
        <FormGrid>
          <Field label="Project title" name="title" required className="sm:col-span-2">
            <Input id="title" name="title" defaultValue={initial.title} maxLength={200} autoComplete="off" />
          </Field>
          <Field label="Client" name="client" required={!internal}>
            <Select id="client" name="client" value={internal ? "" : clientId} disabled={internal} onChange={(e) => setClientId(e.target.value)}>
              <option value="">{internal ? "Internal project" : "Select a client"}</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end pb-2">
            <Switch name="internal" label="Internal project" description="No client — for D4DX's own work" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
          </div>
          <Field label="Description" name="description" className="sm:col-span-2">
            <Textarea id="description" name="description" rows={3} defaultValue={initial.description} />
          </Field>
          <Field label="Scope" name="scope" className="sm:col-span-2">
            <Textarea id="scope" name="scope" rows={3} defaultValue={initial.scope} placeholder="What is in and out of scope" />
          </Field>
          <Field label="Deliverables" name="deliverables" hint="One per line" className="sm:col-span-2">
            <Textarea id="deliverables" name="deliverables" rows={4} defaultValue={initial.deliverables} />
          </Field>
        </FormGrid>
      </FormSection>

      <FormSection title="People">
        <FormGrid>
          <Field label="Project manager" name="manager">
            <PeoplePicker name="manager" options={people} defaultValue={initial.manager} placeholder="Select manager" />
          </Field>
        </FormGrid>
        <Field label="Team" name="team">
          <TeamEditor people={people} initial={initial.team} />
        </Field>
      </FormSection>

      <FormSection title="Planning">
        <FormGrid cols={3}>
          <Field label="Start date" name="startDate">
            <Input id="startDate" name="startDate" type="date" defaultValue={initial.startDate} />
          </Field>
          <Field label="Target completion" name="targetDate">
            <Input id="targetDate" name="targetDate" type="date" defaultValue={initial.targetDate} />
          </Field>
          <Field label="Estimated hours" name="estimatedHours">
            <Input id="estimatedHours" name="estimatedHours" type="number" inputMode="decimal" min={0} step="1" defaultValue={initial.estimatedHours} />
          </Field>
          {showBudget && (
            <Field label="Budget (₹)" name="budget">
              <Input id="budget" name="budget" type="number" inputMode="decimal" min={0} step="1" defaultValue={initial.budget} />
            </Field>
          )}
          <Field label="Priority" name="priority" required>
            <Select id="priority" name="priority" defaultValue={initial.priority}>
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" name="status" required>
            <Select id="status" name="status" defaultValue={initial.status}>
              {statuses.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
        </FormGrid>
      </FormSection>

      {(proposals || contracts) && (
        <FormSection title="References" description="Optional links to the commercial documents behind this project">
          <FormGrid>
            {proposals && (
              <Field label="Proposal" name="proposal">
                <Select id="proposal" name="proposal" key={`p-${clientId}`} defaultValue={forClient(proposals).some((r) => r.id === initial.proposal) ? initial.proposal : ""}>
                  <option value="">None</option>
                  {forClient(proposals).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {contracts && (
              <Field label="Contract" name="contract">
                <Select id="contract" name="contract" key={`c-${clientId}`} defaultValue={forClient(contracts).some((r) => r.id === initial.contract) ? initial.contract : ""}>
                  <option value="">None</option>
                  {forClient(contracts).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </FormGrid>
        </FormSection>
      )}

      <FormActions>
        <ButtonLink href={editing ? `/projects/${initial.id}` : "/projects"} variant="secondary">
          Cancel
        </ButtonLink>
        <SubmitButton>{editing ? "Save changes" : "Create project"}</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}
