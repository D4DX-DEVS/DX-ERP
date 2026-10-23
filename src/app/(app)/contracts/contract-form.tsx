"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, Field, FormActions, FormGrid, FormSection, SubmitButton } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { FileUpload } from "@/components/ui/file-upload";
import { Input, Select, Switch, Textarea } from "@/components/ui/input";
import { createContract, updateContract } from "./actions";

export interface ContractFormInitial {
  id?: string;
  title: string;
  client: string;
  project: string;
  proposal: string;
  type: string;
  startDate: string;
  endDate: string;
  value: string;
  signedOn: string;
  status: "draft" | "active";
  renewalReminderDays: string;
  autoRenew: boolean;
  confidential: boolean;
  notes: string;
}

interface Linkable {
  id: string;
  label: string;
  client?: string;
}

export function ContractForm({
  mode,
  initial,
  clients,
  projects,
  proposals,
  types,
  statusLocked = false,
}: {
  mode: "create" | "edit";
  initial: ContractFormInitial;
  clients: { id: string; name: string; clientNo: string }[];
  projects: Linkable[];
  proposals: Linkable[];
  types: string[];
  /** Expired / terminated / renewed contracts keep their lifecycle status. */
  statusLocked?: boolean;
}) {
  const router = useRouter();
  const [client, setClient] = useState(initial.client);
  const [project, setProject] = useState(initial.project);
  const [proposal, setProposal] = useState(initial.proposal);
  const [confidential, setConfidential] = useState(initial.confidential);

  return (
    <Card>
      <CardBody className="pt-5">
        <ActionForm<{ id: string }>
          action={(input) => (mode === "create" ? createContract(input) : updateContract(initial.id as string, input))}
          successMessage="Contract saved"
          refresh={false}
          onSuccess={(d) => router.push(`/contracts/${d.id}`)}
          className="gap-6"
        >
          <FormSection title="Contract">
            <FormGrid>
              <Field label="Title" name="title" required className="sm:col-span-2">
                <Input id="title" name="title" defaultValue={initial.title} maxLength={200} />
              </Field>
              <Field label="Client" name="client" required>
                <Select
                  id="client"
                  name="client"
                  value={client}
                  onChange={(e) => {
                    setClient(e.target.value);
                    setProject("");
                    setProposal("");
                  }}
                >
                  <option value="">Choose a client…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.clientNo}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Type" name="type" hint="SOW, MSA, AMC, NDA… or your own.">
                <Input id="type" name="type" list="contract-types" defaultValue={initial.type} maxLength={60} autoComplete="off" />
                <datalist id="contract-types">
                  {types.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </Field>
              <Field label="Project" name="project">
                <Select id="project" name="project" value={project} onChange={(e) => setProject(e.target.value)} disabled={!client}>
                  <option value="">{client ? "No project" : "Choose a client first"}</option>
                  {projects
                    .filter((p) => p.client === client)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Proposal" name="proposal">
                <Select id="proposal" name="proposal" value={proposal} onChange={(e) => setProposal(e.target.value)} disabled={!client}>
                  <option value="">{client ? "No proposal" : "Choose a client first"}</option>
                  {proposals
                    .filter((p) => p.client === client)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                </Select>
              </Field>
            </FormGrid>
          </FormSection>

          <FormSection title="Term & value">
            <FormGrid cols={3}>
              <Field label="Start date" name="startDate">
                <Input id="startDate" name="startDate" type="date" defaultValue={initial.startDate} />
              </Field>
              <Field label="End date" name="endDate">
                <Input id="endDate" name="endDate" type="date" defaultValue={initial.endDate} />
              </Field>
              <Field label="Signed on" name="signedOn">
                <Input id="signedOn" name="signedOn" type="date" defaultValue={initial.signedOn} />
              </Field>
              <Field label="Contract value (₹)" name="value">
                <Input id="value" name="value" type="number" inputMode="decimal" min={0} step="any" defaultValue={initial.value} />
              </Field>
              {statusLocked ? (
                <input type="hidden" name="status" value={initial.status} />
              ) : (
                <Field label="Status" name="status">
                  <Select id="status" name="status" defaultValue={initial.status}>
                    <option value="draft">Awaiting signature</option>
                    <option value="active">Active</option>
                  </Select>
                </Field>
              )}
              <Field label="Renewal reminder (days before end)" name="renewalReminderDays">
                <Input id="renewalReminderDays" name="renewalReminderDays" type="number" inputMode="numeric" min={0} max={365} defaultValue={initial.renewalReminderDays} />
              </Field>
            </FormGrid>
            <Switch name="autoRenew" defaultChecked={initial.autoRenew} label="Auto-renew" description="Flags the contract as auto-renewing in reminders. Renewals are still created from the contract page." />
          </FormSection>

          <FormSection title="Access & notes">
            <Switch
              name="confidential"
              checked={confidential}
              onChange={(e) => setConfidential(e.target.checked)}
              label="Confidential"
              description="Hides the value, notes and files from people who don't manage contracts or hold access to restricted client information."
            />
            <Field label="Notes" name="notes">
              <Textarea id="notes" name="notes" rows={4} defaultValue={initial.notes} maxLength={5000} />
            </Field>
            {mode === "create" && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold text-ink-2">Signed contract</span>
                <FileUpload context={{ entityType: "contract", confidential }} label="Upload signed contract" />
                <p className="text-xs text-muted">Upload the signed PDF now, or add it later from the contract page.</p>
              </div>
            )}
          </FormSection>

          <FormActions>
            <Button variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <SubmitButton>{mode === "create" ? "Create contract" : "Save changes"}</SubmitButton>
          </FormActions>
        </ActionForm>
      </CardBody>
    </Card>
  );
}
