"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ActionForm, Field, FormActions, FormGrid, FormSection, SubmitButton } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Input, Select, Switch, Textarea } from "@/components/ui/input";
import { PeoplePicker, type PickerOption } from "@/components/ui/people-picker";
import { createClient, updateClient, type ClientSaveResult } from "./actions";
import { DuplicateWarning } from "../_components/duplicate-warning";
import { CLIENT_TYPES } from "../_lib/constants";
import type { DuplicateReport } from "../_lib/duplicates";

export interface ClientFormInitial {
  id?: string;
  name: string;
  type: "company" | "individual";
  contactPerson: string;
  contactDesignation: string;
  email: string;
  phone: string;
  altPhone: string;
  website: string;
  industry: string;
  gstin: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  leadSource: string;
  owner: string;
  status: string;
  confidential: boolean;
  notes: string;
}

export function ClientForm({
  mode,
  initial,
  people,
  sources,
  statuses,
  canSetConfidential,
}: {
  mode: "create" | "edit";
  initial: ClientFormInitial;
  people: PickerOption[];
  sources: string[];
  statuses: { value: string; label: string }[];
  canSetConfidential: boolean;
}) {
  const router = useRouter();
  const [duplicates, setDuplicates] = useState<DuplicateReport | null>(null);
  const sourceOptions = initial.leadSource && !sources.includes(initial.leadSource) ? [...sources, initial.leadSource] : sources;

  const created = (id: string) => {
    toast.success("Client created");
    router.push(`/crm/clients/${id}`);
  };

  return (
    <Card>
      <CardBody className="pt-5">
        <ActionForm<ClientSaveResult>
          action={(input) => (mode === "create" ? createClient(input) : updateClient(initial.id as string, input))}
          successMessage={false}
          refresh={mode === "edit"}
          onSuccess={(data) => {
            if ("duplicates" in data) {
              setDuplicates(data.duplicates);
              return;
            }
            if (mode === "create") created(data.id);
            else {
              toast.success("Client updated");
              router.push(`/crm/clients/${data.id}`);
            }
          }}
          className="gap-6"
        >
          {duplicates && <DuplicateWarning report={duplicates} submit={createClient} onCreated={created} noun="client" />}

          <FormSection title="Profile">
            <FormGrid>
              <Field label="Name" name="name" required className="sm:col-span-2">
                <Input id="name" name="name" defaultValue={initial.name} maxLength={200} autoComplete="organization" />
              </Field>
              <Field label="Type" name="type">
                <Select id="type" name="type" defaultValue={initial.type}>
                  {CLIENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Status" name="status">
                <Select id="status" name="status" defaultValue={initial.status}>
                  {statuses.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Industry" name="industry">
                <Input id="industry" name="industry" defaultValue={initial.industry} maxLength={100} />
              </Field>
              <Field label="Website" name="website">
                <Input id="website" name="website" type="url" inputMode="url" defaultValue={initial.website} placeholder="https://" />
              </Field>
            </FormGrid>
          </FormSection>

          <FormSection title="Contact">
            <FormGrid>
              <Field label="Contact person" name="contactPerson">
                <Input id="contactPerson" name="contactPerson" defaultValue={initial.contactPerson} maxLength={200} autoComplete="off" />
              </Field>
              <Field label="Designation" name="contactDesignation">
                <Input id="contactDesignation" name="contactDesignation" defaultValue={initial.contactDesignation} maxLength={200} autoComplete="off" />
              </Field>
              <Field label="Email" name="email">
                <Input id="email" name="email" type="email" defaultValue={initial.email} autoComplete="off" />
              </Field>
              <Field label="Phone" name="phone">
                <Input id="phone" name="phone" type="tel" defaultValue={initial.phone} autoComplete="off" />
              </Field>
              <Field label="Alternate phone" name="altPhone">
                <Input id="altPhone" name="altPhone" type="tel" defaultValue={initial.altPhone} autoComplete="off" />
              </Field>
            </FormGrid>
          </FormSection>

          <FormSection title="Business details">
            <FormGrid>
              <Field label="GSTIN" name="gstin" hint="15 characters, used on invoices.">
                <Input id="gstin" name="gstin" defaultValue={initial.gstin} maxLength={15} className="uppercase" autoComplete="off" />
              </Field>
              <Field label="Address line 1" name="addressLine1">
                <Input id="addressLine1" name="addressLine1" defaultValue={initial.addressLine1} autoComplete="off" />
              </Field>
              <Field label="Address line 2" name="addressLine2">
                <Input id="addressLine2" name="addressLine2" defaultValue={initial.addressLine2} autoComplete="off" />
              </Field>
              <Field label="City" name="city">
                <Input id="city" name="city" defaultValue={initial.city} autoComplete="off" />
              </Field>
              <Field label="State" name="state">
                <Input id="state" name="state" defaultValue={initial.state} autoComplete="off" />
              </Field>
              <Field label="Postal code" name="postalCode">
                <Input id="postalCode" name="postalCode" defaultValue={initial.postalCode} autoComplete="off" />
              </Field>
              <Field label="Country" name="country">
                <Input id="country" name="country" defaultValue={initial.country} autoComplete="off" />
              </Field>
            </FormGrid>
          </FormSection>

          <FormSection title="Ownership">
            <FormGrid>
              <Field label="Business development owner" name="owner">
                <PeoplePicker name="owner" options={people} defaultValue={initial.owner} placeholder="Select owner" />
              </Field>
              <Field label="Lead source" name="leadSource">
                <Select id="leadSource" name="leadSource" defaultValue={initial.leadSource}>
                  <option value="">Not specified</option>
                  {sourceOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </Field>
            </FormGrid>
            {canSetConfidential && (
              <Switch
                name="confidential"
                defaultChecked={initial.confidential}
                label="Restricted client"
                description="Only people with access to restricted client information, and the owner, can see this client, its leads, activity and files."
              />
            )}
            <Field label="Notes" name="notes">
              <Textarea id="notes" name="notes" rows={4} defaultValue={initial.notes} maxLength={5000} />
            </Field>
          </FormSection>

          <FormActions>
            <Button variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <SubmitButton>{mode === "create" ? "Create client" : "Save changes"}</SubmitButton>
          </FormActions>
        </ActionForm>
      </CardBody>
    </Card>
  );
}
