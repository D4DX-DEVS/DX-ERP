"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ActionForm, Field, FormActions, FormGrid, FormSection, SubmitButton } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PeoplePicker, type PickerOption } from "@/components/ui/people-picker";
import { createLead, updateLead, type LeadSaveResult } from "../actions";
import { DuplicateWarning } from "../_components/duplicate-warning";
import type { DuplicateReport } from "../_lib/duplicates";

export interface ClientOption {
  id: string;
  name: string;
  clientNo: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
}

export interface LeadFormInitial {
  id?: string;
  title: string;
  client: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  requirement: string;
  budget: string;
  expectedValue: string;
  source: string;
  assignedTo: string;
  stage: string;
  nextFollowUp: string;
  expectedCloseDate: string;
}

export function LeadForm({
  mode,
  initial,
  clients,
  people,
  sources,
  stages,
  clientLocked = false,
}: {
  mode: "create" | "edit";
  initial: LeadFormInitial;
  clients: ClientOption[];
  people: PickerOption[];
  sources: string[];
  stages: { key: string; label: string }[];
  clientLocked?: boolean;
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState(initial.client);
  const [companyName, setCompanyName] = useState(initial.companyName);
  const [contactName, setContactName] = useState(initial.contactName);
  const [email, setEmail] = useState(initial.email);
  const [phone, setPhone] = useState(initial.phone);
  const [duplicates, setDuplicates] = useState<DuplicateReport | null>(null);
  const byId = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const sourceOptions = initial.source && !sources.includes(initial.source) ? [...sources, initial.source] : sources;

  const created = (id: string) => {
    toast.success("Lead created");
    router.push(`/crm/leads/${id}`);
  };

  return (
    <Card>
      <CardBody className="pt-5">
        <ActionForm<LeadSaveResult>
          action={(input) => (mode === "create" ? createLead(input) : updateLead(initial.id as string, input))}
          successMessage={false}
          refresh={mode === "edit"}
          onSuccess={(data) => {
            if ("duplicates" in data) {
              setDuplicates(data.duplicates);
              return;
            }
            if (mode === "create") created(data.id);
            else {
              toast.success("Lead updated");
              router.push(`/crm/leads/${data.id}`);
            }
          }}
          className="gap-6"
        >
          {duplicates && <DuplicateWarning report={duplicates} submit={createLead} onCreated={created} noun="lead" />}

          <FormSection title="Lead">
            <FormGrid>
              <Field label="Title" name="title" required className="sm:col-span-2" hint="What is the opportunity? e.g. “Inventory portal”">
                <Input id="title" name="title" defaultValue={initial.title} maxLength={200} />
              </Field>
              {mode === "create" && (
                <Field label="Stage" name="stage" required>
                  <Select id="stage" name="stage" defaultValue={initial.stage}>
                    {stages.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="Source" name="source">
                <Select id="source" name="source" defaultValue={initial.source}>
                  <option value="">Not specified</option>
                  {sourceOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </Field>
            </FormGrid>
          </FormSection>

          <FormSection title="Client & contact" description="Pick an existing client, or type a new company name — a client record is created when the lead is won.">
            <FormGrid>
              <Field label="Client" name="client" hint={clientLocked ? "The client can't be changed once the lead is closed or has a proposal." : undefined}>
                <Select
                  id="client"
                  name="client"
                  value={clientId}
                  disabled={clientLocked}
                  onChange={(e) => {
                    const id = e.target.value;
                    setClientId(id);
                    const c = byId.get(id);
                    if (c) {
                      setContactName(c.contactPerson ?? "");
                      setEmail(c.email ?? "");
                      setPhone(c.phone ?? "");
                    }
                  }}
                >
                  <option value="">New company (type the name)</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.clientNo}
                    </option>
                  ))}
                </Select>
              </Field>
              {!clientId && (
                <Field label="Company name" name="companyName" required>
                  <Input id="companyName" name="companyName" value={companyName} onChange={(e) => setCompanyName(e.target.value)} maxLength={200} autoComplete="organization" />
                </Field>
              )}
              <Field label="Contact name" name="contactName">
                <Input id="contactName" name="contactName" value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={200} autoComplete="off" />
              </Field>
              <Field label="Email" name="email">
                <Input id="email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
              </Field>
              <Field label="Phone" name="phone">
                <Input id="phone" name="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
              </Field>
            </FormGrid>
          </FormSection>

          <FormSection title="Opportunity">
            <Field label="Requirement" name="requirement">
              <Textarea id="requirement" name="requirement" rows={4} defaultValue={initial.requirement} maxLength={5000} placeholder="What does the client need?" />
            </Field>
            <FormGrid>
              <Field label="Client budget (₹)" name="budget">
                <Input id="budget" name="budget" type="number" inputMode="decimal" min={0} step="any" defaultValue={initial.budget} />
              </Field>
              <Field label="Expected value (₹)" name="expectedValue" hint="Used for pipeline totals and weighted forecast.">
                <Input id="expectedValue" name="expectedValue" type="number" inputMode="decimal" min={0} step="any" defaultValue={initial.expectedValue} />
              </Field>
            </FormGrid>
          </FormSection>

          <FormSection title="Ownership & timing">
            <FormGrid>
              <Field label="Assigned BD person" name="assignedTo">
                <PeoplePicker name="assignedTo" options={people} defaultValue={initial.assignedTo} placeholder="Select owner" />
              </Field>
              <Field label="Next follow-up" name="nextFollowUp">
                <Input id="nextFollowUp" name="nextFollowUp" type="datetime-local" defaultValue={initial.nextFollowUp} />
              </Field>
              <Field label="Expected close date" name="expectedCloseDate">
                <Input id="expectedCloseDate" name="expectedCloseDate" type="date" defaultValue={initial.expectedCloseDate} />
              </Field>
            </FormGrid>
          </FormSection>

          <FormActions>
            <Button variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <SubmitButton>{mode === "create" ? "Create lead" : "Save changes"}</SubmitButton>
          </FormActions>
        </ActionForm>
      </CardBody>
      <Link href="/crm" className="sr-only">
        Back to pipeline
      </Link>
    </Card>
  );
}
